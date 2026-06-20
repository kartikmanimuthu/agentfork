import type { LanguageModelMiddleware } from 'ai';
import { processPiiRedaction, createLogger } from '@chatbot/shared';
import { outputLooksSuspicious } from './heuristic';
import { secretDetectRule } from '../rules/secret-detect';
import type { RuleContext, RuleFinding } from '../rules/types';
import { judgeText } from '../judge/llm-judge';
import type { GuardrailContext } from '../engine/types';

const logger = createLogger('guardrail:output');

const ROLLING_BUFFER = 200;

function maskText(text: string, ctx: GuardrailContext): string {
  let out = text;
  const cfg = ctx.config;
  if (cfg.output.piiRedaction.enabled) out = processPiiRedaction(out, cfg.output.piiRedaction.customPatterns);
  if (cfg.output.secretDetection.enabled) {
    const rc: RuleContext = { config: cfg, tenantId: ctx.tenantId, agentId: ctx.agentId, phase: 'output' };
    const f = secretDetectRule.evaluate(out, rc) as RuleFinding;
    if (f.maskedText) out = f.maskedText;
  }
  if (cfg.output.bannedPhrases.phrases.length) {
    for (const p of cfg.output.bannedPhrases.phrases) {
      try { out = out.replace(new RegExp(p, 'g'), '[REDACTED]'); } catch { /* skip */ }
    }
  }
  return out;
}

export function createGuardrailsMiddleware(ctx: GuardrailContext): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    wrapStream: async ({ doStream }) => {
      const original = await doStream();
      const cfg = ctx.config;

      const transformed = original.stream.pipeThrough(
        new TransformStream<any, any>({
          buffer: '',
          accumulated: '',
          transform(part: any, controller: any) {
            try {
              if (part.type === 'text-delta') {
                // ts hack: attach buffers via the controller-less closure below
                (this as any).buffer = ((this as any).buffer ?? '') + part.delta;
                // flush everything except the trailing ROLLING_BUFFER chars (boundary-safe)
                const buf: string = (this as any).buffer;
                const flushable = buf.length > ROLLING_BUFFER ? buf.slice(0, buf.length - ROLLING_BUFFER) : '';
                if (flushable) {
                  (this as any).buffer = buf.slice(buf.length - ROLLING_BUFFER);
                  const masked = ctx.config.enabled ? maskText(flushable, ctx) : flushable;
                  (this as any).accumulated = ((this as any).accumulated ?? '') + masked;
                  controller.enqueue({ ...part, delta: masked });
                }
              } else {
                controller.enqueue(part);
              }
            } catch (err) {
              // fail open: pass the part through unmasked
              logger.error({ tenantId: ctx.tenantId, errorMessage: (err as Error).message }, 'Output mask failed — passing through');
              controller.enqueue(part);
            }
          },
          flush(controller: any) {
            try {
              const buf: string = (this as any).buffer ?? '';
              if (buf) {
                const masked = ctx.config.enabled ? maskText(buf, ctx) : buf;
                (this as any).accumulated = ((this as any).accumulated ?? '') + masked;
                controller.enqueue({ type: 'text-delta', id: 'guardrails-flush', delta: masked });
              }
              const finalText: string = (this as any).accumulated ?? '';
              // Heuristic-gated judge (audit-only for streaming output).
              if (ctx.config.enabled && cfg.judge.enabled && finalText && outputLooksSuspicious(finalText, cfg)) {
                judgeText({
                  text: finalText,
                  categories: ['toxicity', 'off-topic', 'secret-leak'],
                  ctx: { config: cfg, tenantId: ctx.tenantId, agentId: ctx.agentId, agentVersionId: ctx.agentVersionId },
                })
                  .then((v) => {
                    if (v.violated) logger.warn({ tenantId: ctx.tenantId, agentId: ctx.agentId, category: v.category }, 'Output judge flagged (audit-only)');
                  })
                  .catch(() => { /* fail open */ });
              }
            } catch (err) {
              logger.error({ tenantId: ctx.tenantId, agentId: ctx.agentId, errorMessage: (err as Error).message }, 'Output flush failed');
            }
          },
        } as any),
      );

      return { ...original, stream: transformed };
    },
  };
}
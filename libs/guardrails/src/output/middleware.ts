import type { LanguageModelMiddleware } from 'ai';
import { processPiiRedaction, createLogger } from '@chatbot/shared';
import { outputLooksSuspicious } from './heuristic';
import { secretDetectRule } from '../rules/secret-detect';
import type { RuleContext, RuleFinding } from '../rules/types';
import { judgeText } from '../judge/llm-judge';
import type { GuardrailContext } from '../engine/types';

const logger = createLogger('guardrail:output');

// Hold-back window: PII/secret patterns can span chunk boundaries (e.g. an SSN
// split across two text-deltas). We buffer the trailing ROLLING_BUFFER chars and
// only flush the portion we're confident is complete, deferring the tail until
// more arrives or the text part ends.
const ROLLING_BUFFER = 200;

interface MaskStats {
  redacted: boolean;
  replacements: number;
}

function countInsertedTokens(before: string, after: string): number {
  // Proxy for redaction count: bracketed UPPER-CASE placeholders (e.g. [SSN], [EMAIL])
  // present in `after` but not in `before`. Lossy but sufficient for debug telemetry.
  const beforeCount = (before.match(/\[[A-Z][A-Z0-9 _-]*\]/g) ?? []).length;
  const afterCount = (after.match(/\[[A-Z][A-Z0-9 _-]*\]/g) ?? []).length;
  return Math.max(0, afterCount - beforeCount);
}

function maskText(text: string, ctx: GuardrailContext): { text: string; stats: MaskStats } {
  let out = text;
  const cfg = ctx.config;
  let replacements = 0;

  if (cfg.output.piiRedaction.enabled) {
    const before = out;
    out = processPiiRedaction(out, cfg.output.piiRedaction.customPatterns);
    replacements += countInsertedTokens(before, out);
  }
  if (cfg.output.secretDetection.enabled) {
    const rc: RuleContext = { config: cfg, tenantId: ctx.tenantId, agentId: ctx.agentId, phase: 'output' };
    const before = out;
    const f = secretDetectRule.evaluate(out, rc) as RuleFinding;
    if (f.maskedText) {
      replacements += countInsertedTokens(before, f.maskedText);
      out = f.maskedText;
    }
  }
  if (cfg.output.bannedPhrases.phrases.length) {
    for (const p of cfg.output.bannedPhrases.phrases) {
      try {
        const re = new RegExp(p, 'g');
        const matches = out.match(re);
        if (matches) {
          replacements += matches.length;
          out = out.replace(re, '[REDACTED]');
        }
      } catch {
        /* skip invalid regex pattern */
      }
    }
  }

  return { text: out, stats: { redacted: out !== text, replacements } };
}

export function createGuardrailsMiddleware(ctx: GuardrailContext): LanguageModelMiddleware {
  const cfg = ctx.config;

  const outputMaskingActive =
    cfg.output.piiRedaction.enabled ||
    cfg.output.secretDetection.enabled ||
    cfg.output.bannedPhrases.phrases.length > 0;
  // Skip the transform entirely when there's nothing to mask and no judge to run
  // (avoids pointless buffering on every enabled-but-output-idle agent).
  const middlewareNeeded = cfg.enabled && (outputMaskingActive || cfg.judge.enabled);

  logger.debug(
    {
      tenantId: ctx.tenantId,
      agentId: ctx.agentId,
      enabled: cfg.enabled,
      maskingActive: outputMaskingActive,
      pii: cfg.output.piiRedaction.enabled,
      secret: cfg.output.secretDetection.enabled,
      bannedPhrases: cfg.output.bannedPhrases.phrases.length,
      judge: cfg.judge.enabled,
      middlewareNeeded,
    },
    'Output guardrail middleware attached',
  );

  return {
    specificationVersion: 'v3',
    wrapStream: async ({ doStream }) => {
      const original = await doStream();
      if (!middlewareNeeded) {
        logger.debug({ tenantId: ctx.tenantId, agentId: ctx.agentId }, 'Output guardrail middleware bypassed — no output rules or judge active');
        return original;
      }

      const transformed = original.stream.pipeThrough(
        new TransformStream<any, any>({
          buffer: '',
          accumulated: '',
          // id of the currently-open text part (set on text-start, cleared on text-end).
          // text-delta parts MUST reference an id opened by a prior text-start, otherwise
          // the AI SDK emits an `error` part ("text part <id> not found") and the stream
          // fails. We never fabricate ids — we always reuse the active part's id.
          textId: null as string | null,

          flushHeld(this: any, controller: any) {
            const buf: string = this.buffer ?? '';
            if (!buf || !this.textId) return;
            const { text: masked, stats } = maskText(buf, ctx);
            this.accumulated = (this.accumulated ?? '') + masked;
            controller.enqueue({ type: 'text-delta', id: this.textId, delta: masked });
            this.buffer = '';
            logger.debug(
              { tenantId: ctx.tenantId, agentId: ctx.agentId, partId: this.textId, flushedLen: buf.length, redacted: stats.redacted, replacements: stats.replacements },
              'Output tail flushed',
            );
          },

          transform(part: any, controller: any) {
            try {
              if (part.type === 'text-start') {
                this.textId = part.id;
                controller.enqueue(part);
                return;
              }

              if (part.type === 'text-delta') {
                // Defensive fallback: if a provider omits text-start, adopt the delta's id.
                if (!this.textId) this.textId = part.id;
                this.buffer = (this.buffer ?? '') + part.delta;
                const buf: string = this.buffer;
                const flushable = buf.length > ROLLING_BUFFER ? buf.slice(0, buf.length - ROLLING_BUFFER) : '';
                if (flushable) {
                  this.buffer = buf.slice(buf.length - ROLLING_BUFFER);
                  const { text: masked, stats } = maskText(flushable, ctx);
                  this.accumulated = (this.accumulated ?? '') + masked;
                  controller.enqueue({ type: 'text-delta', id: this.textId, delta: masked });
                  logger.debug(
                    { tenantId: ctx.tenantId, agentId: ctx.agentId, partId: this.textId, flushedLen: flushable.length, heldLen: this.buffer.length, redacted: stats.redacted, replacements: stats.replacements },
                    'Output chunk masked',
                  );
                }
                return;
              }

              if (part.type === 'text-end') {
                // Flush the held tail BEFORE forwarding text-end: a text-delta must not
                // follow text-end (the SDK deletes the id on text-end, so a later delta
                // with that id would error). This is the fix for "text part guardrails-flush
                // not found" — the old code flushed at stream end with a fabricated id.
                (this as any).flushHeld(controller, true);
                this.textId = null;
                controller.enqueue(part);
                return;
              }

              // tool-call, reasoning-*, finish, raw, etc. pass through untouched.
              controller.enqueue(part);
            } catch (err) {
              // Fail open: pass the part through unmasked rather than break the stream.
              logger.error(
                { tenantId: ctx.tenantId, agentId: ctx.agentId, partType: part?.type, errorMessage: (err as Error).message },
                'Output transform failed — passing part through (fail-open)',
              );
              try {
                controller.enqueue(part);
              } catch {
                /* downstream already closed — nothing to do */
              }
            }
          },

          flush(controller: any) {
            try {
              // Stream ended without a text-end (e.g. abort) — flush any still-held tail
              // using the last-known text id. No-op when text-end already flushed it.
              (this as any).flushHeld(controller, true);

              const finalText: string = (this as any).accumulated ?? '';
              const suspicious =
                cfg.judge.enabled && finalText.length > 0 && outputLooksSuspicious(finalText, cfg);

              if (suspicious) {
                logger.info(
                  { tenantId: ctx.tenantId, agentId: ctx.agentId, finalLen: finalText.length },
                  'Output heuristic flagged — invoking judge (audit-only)',
                );
                judgeText({
                  text: finalText,
                  categories: ['toxicity', 'off-topic', 'secret-leak'],
                  ctx: {
                    config: cfg,
                    tenantId: ctx.tenantId,
                    agentId: ctx.agentId,
                    agentVersionId: ctx.agentVersionId,
                  },
                })
                  .then((v) => {
                    if (v.degraded) {
                      logger.warn({ tenantId: ctx.tenantId, agentId: ctx.agentId }, 'Output judge failed open — verdict unavailable');
                    } else if (v.violated) {
                      logger.warn({ tenantId: ctx.tenantId, agentId: ctx.agentId, category: v.category }, 'Output judge flagged (audit-only)');
                    } else {
                      logger.debug({ tenantId: ctx.tenantId, agentId: ctx.agentId }, 'Output judge cleared output');
                    }
                  })
                  .catch((err: unknown) => {
                    logger.error(
                      { tenantId: ctx.tenantId, agentId: ctx.agentId, errorMessage: (err as Error).message },
                      'Output judge rejected — fail open',
                    );
                  });
              } else {
                logger.debug(
                  { tenantId: ctx.tenantId, agentId: ctx.agentId, finalLen: finalText.length, judgeEnabled: cfg.judge.enabled, suspicious: false },
                  'Output stream complete',
                );
              }
            } catch (err) {
              logger.error(
                { tenantId: ctx.tenantId, agentId: ctx.agentId, errorMessage: (err as Error).message },
                'Output flush failed — fail open',
              );
            }
          },
        } as any),
      );

      return { ...original, stream: transformed };
    },
  };
}
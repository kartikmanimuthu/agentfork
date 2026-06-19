import type { ModelMessage } from 'ai';
import type { GuardrailContext, GuardrailResult, GuardrailDecision } from './types';
import { INPUT_RULE_ORDER, evaluateRule } from './pipeline';
import { judgeText } from '../judge/llm-judge';
import type { RuleContext } from '../rules/types';
import { createLogger } from '@chatbot/shared';

const logger = createLogger('guardrail:engine');

function extractText(message: ModelMessage): string {
  const c = message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((p: any) => p.type === 'text').map((p: any) => p.text ?? '').join(' ');
  return '';
}

function withText(message: ModelMessage, text: string): ModelMessage {
  return { ...message, content: text } as ModelMessage;
}

export async function runInputGuardrails(
  messages: ModelMessage[],
  gctx: GuardrailContext,
): Promise<GuardrailResult> {
  const cfg = gctx.config;
  if (!cfg.enabled) return { decision: 'pass', triggered: [], degraded: false };

  try {
    const decisions: GuardrailDecision[] = [];
    let masked = false;
    let current = messages;
    let degraded = false;

    const ruleCtx = (phase: 'input' | 'output'): RuleContext => ({
      config: cfg,
      tenantId: gctx.tenantId,
      agentId: gctx.agentId,
      agentVersionId: gctx.agentVersionId,
      phase,
    });

    for (const rule of INPUT_RULE_ORDER) {
      const userMsg = current[current.length - 1];
      if (!userMsg) break;
      const text = extractText(userMsg);
      const finding = evaluateRule(rule, text, ruleCtx('input'));

      if (finding.degraded) degraded = true;
      if (finding.matched) {
        decisions.push({
          ruleId: rule.id,
          action: finding.action,
          reason: finding.reason,
          flagsSuspicion: finding.flagsSuspicion,
        });
        if (finding.action === 'block') {
          logger.info({ tenantId: gctx.tenantId, agentId: gctx.agentId, ruleId: rule.id }, 'Input blocked');
          return { decision: 'block', refusalMessage: cfg.refusalMessage, triggered: decisions, degraded };
        }
        if (finding.action === 'mask' && finding.maskedText !== undefined) {
          masked = true;
          current = current.map((m, i) => (i === current.length - 1 ? withText(m, finding.maskedText!) : m));
        }
      }

      // Heuristic-gated judge: only escalate when a rule flags suspicion and judge is enabled.
      if (finding.flagsSuspicion && cfg.judge?.enabled) {
        const verdict = await judgeText({
          text: extractText(current[current.length - 1]),
          categories: ['prompt-injection', 'toxicity', 'off-topic'],
          ctx: {
            config: cfg,
            tenantId: gctx.tenantId,
            agentId: gctx.agentId,
            agentVersionId: gctx.agentVersionId,
          },
        });
        if (verdict.degraded) degraded = true;
        if (verdict.violated) {
          const action =
            cfg.input?.injectionDetection?.enabled && cfg.input?.injectionDetection?.action === 'block'
              ? 'block'
              : 'warn';
          decisions.push({
            ruleId: 'llm-judge',
            action,
            reason: `judge:${verdict.category}`,
            flagsSuspicion: false,
            degraded: verdict.degraded,
          });
          if (action === 'block') {
            return { decision: 'block', refusalMessage: cfg.refusalMessage, triggered: decisions, degraded };
          }
        }
      }
    }

    return masked
      ? { decision: 'mask', maskedMessages: current, triggered: decisions, degraded }
      : { decision: 'pass', triggered: decisions, degraded };
  } catch (err) {
    // Top-level backstop: a guardrail failure must never break the chat.
    logger.error(
      { err, tenantId: gctx.tenantId, agentId: gctx.agentId },
      'runInputGuardrails unexpected error; failing open'
    );
    return { decision: 'pass', triggered: [], degraded: true };
  }
}
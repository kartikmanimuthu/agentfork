import { processPiiRedaction } from '@chatbot/shared';
import { secretDetectRule } from './secret-detect';
import type { GuardrailsConfig } from '../config/schema';
import type { RuleContext, RuleFinding } from './types';

/**
 * Mask PII and secrets in text destined for PERSISTENCE (session/execution
 * store) when the agent's input guardrails have redaction enabled. Used at the
 * persistence point so the stored user turn never contains raw PII/secrets even
 * though the model-facing pipeline runs the full `runInputGuardrails` later.
 *
 * - PII: applied when `config.input.piiRedaction.enabled`.
 * - Secrets: applied when `config.input.secretDetection.enabled`, regardless of
 *   the configured action. Even when the action is `block` (which would refuse
 *   the request downstream in the input-guardrails block), the persisted content
 *   is masked here so a raw secret is never written to the DB on the block path.
 *
 * When both input redactions are disabled (or guardrails disabled), the text is
 * returned unchanged. This helper is pure string ops and will not realistically
 * throw; callers should still wrap it in try/catch and fall back to the original
 * text on error so the chat path never 500s (fail-open on persistence).
 */
export function redactInputPiiAndSecrets(text: string, config: GuardrailsConfig): string {
  let out = text;
  if (config.input.piiRedaction.enabled) {
    out = processPiiRedaction(out, config.input.piiRedaction.customPatterns);
  }
  if (config.input.secretDetection.enabled) {
    const rc: RuleContext = { config, tenantId: '', agentId: '', phase: 'input' };
    const finding = secretDetectRule.evaluate(out, rc) as RuleFinding;
    if (finding.maskedText) out = finding.maskedText;
  }
  return out;
}
import { processPiiRedaction } from '@chatbot/shared';
import type { Rule, RuleContext, RuleFinding } from './types';

export const piiRedactRule: Rule = {
  id: 'pii-redact',
  phase: 'input', // evaluated for both phases via the engine
  evaluate(text, ctx: RuleContext): RuleFinding {
    const cfg = ctx.phase === 'input' ? ctx.config.input.piiRedaction : ctx.config.output.piiRedaction;
    if (!cfg.enabled) return { matched: false, action: 'mask' };
    const masked = processPiiRedaction(text, cfg.customPatterns);
    if (masked === text) return { matched: false, action: 'mask' };
    return { matched: true, action: 'mask', maskedText: masked, reason: 'pii-redacted' };
  },
};
import type { Rule, RuleContext, RuleFinding } from './types';

function maskAll(text: string, phrases: string[]): string {
  let out = text;
  for (const p of phrases) {
    try {
      out = out.replace(new RegExp(p, 'g'), '[REDACTED]');
    } catch {
      // invalid regex phrase — skip
    }
  }
  return out;
}

export const keywordDenyRule: Rule = {
  id: 'keyword-deny',
  phase: 'input',
  evaluate(text, ctx: RuleContext): RuleFinding {
    const cfg = ctx.phase === 'input' ? ctx.config.input.bannedPhrases : ctx.config.output.bannedPhrases;
    if (!cfg.phrases.length) return { matched: false, action: cfg.action };
    const masked = maskAll(text, cfg.phrases);
    if (masked === text) return { matched: false, action: cfg.action };
    if (cfg.action === 'mask') return { matched: true, action: 'mask', maskedText: masked, reason: 'banned-phrase' };
    return { matched: true, action: cfg.action, maskedText: masked, reason: 'banned-phrase', flagsSuspicion: cfg.action === 'block' };
  },
};
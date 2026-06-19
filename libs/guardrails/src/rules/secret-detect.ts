import type { Rule, RuleContext, RuleFinding } from './types';

const SECRET_PATTERNS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/g,                          // AWS access key id
  /\bsk-[a-zA-Z0-9]{20,}\b/g,                        // OpenAI-style
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,                 // GitHub tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,             // PEM private-key header (BEGIN-only)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, // full PEM block
  /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, // JWT
];

export const secretDetectRule: Rule = {
  id: 'secret-detect',
  phase: 'input',
  evaluate(text, ctx: RuleContext): RuleFinding {
    const cfg = ctx.phase === 'input' ? ctx.config.input.secretDetection : ctx.config.output.secretDetection;
    if (!cfg.enabled) return { matched: false, action: cfg.action };
    let masked = text;
    let matched = false;
    for (const re of SECRET_PATTERNS) {
      const next = masked.replace(re, '[REDACTED]');
      if (next !== masked) matched = true;
      masked = next;
    }
    if (!matched) return { matched: false, action: cfg.action };
    return { matched: true, action: cfg.action, maskedText: masked, reason: 'secret-detected', flagsSuspicion: true };
  },
};
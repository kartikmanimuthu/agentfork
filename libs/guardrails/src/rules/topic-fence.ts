import type { Rule, RuleContext, RuleFinding } from './types';

function anyMatch(text: string, subjects: string[]): boolean {
  return subjects.some((s) => {
    try { return new RegExp(s, 'i').test(text); } catch { return text.toLowerCase().includes(s.toLowerCase()); }
  });
}

export const topicFenceRule: Rule = {
  id: 'topic-fence',
  phase: 'input',
  evaluate(text, ctx: RuleContext): RuleFinding {
    const cfg = ctx.phase === 'input' ? ctx.config.input.topicFence : ctx.config.output.topicFence;
    const useKeyword = cfg.mode === 'keyword';
    if (!useKeyword) return { matched: false, action: cfg.action }; // judge mode handled by LlmJudge
    if (cfg.deniedSubjects?.length && anyMatch(text, cfg.deniedSubjects)) {
      return { matched: true, action: cfg.action, reason: 'denied-subject', flagsSuspicion: cfg.mode === 'both' };
    }
    if (cfg.allowedSubjects?.length && !anyMatch(text, cfg.allowedSubjects)) {
      return { matched: true, action: cfg.action, reason: 'off-topic', flagsSuspicion: cfg.mode === 'both' };
    }
    return { matched: false, action: cfg.action };
  },
};
import type { Rule, RuleContext, RuleFinding } from './types';

const INJECTION_MARKERS: RegExp[] = [
  /ignore (?:all |any |the )?(?:previous|prior) instructions/i,
  /disregard (?:all |any |the )?(?:previous|prior) (?:instructions|rules)/i,
  /you are (?:now )?(?:a |an )??(?:dan|jailbreak|developer mode)/i,
  /reveal (?:your )?(?:system )?prompt/i,
  /act as (?:if you are |an? )?(?:a |an )?(?:different|unrestricted)/i,
  /\bdo anything now\b/i,
];

export const injectionHeuristicRule: Rule = {
  id: 'injection-heuristic',
  phase: 'input',
  evaluate(text, ctx: RuleContext): RuleFinding {
    const cfg = ctx.config.input.injectionDetection;
    if (!cfg.enabled) return { matched: false, action: 'warn' };
    const flagged = INJECTION_MARKERS.some((re) => re.test(text));
    if (!flagged) return { matched: false, action: 'warn' };
    // Heuristic only flags suspicion; the pipeline escalates to the LLM judge,
    // and only on a confirmed violation does the configured action apply.
    return { matched: false, action: cfg.action, reason: 'injection-suspected', flagsSuspicion: true };
  },
};
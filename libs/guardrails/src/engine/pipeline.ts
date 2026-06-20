import type { Rule, RuleContext, RuleFinding } from '../rules/types';
import { piiRedactRule } from '../rules/pii-redact';
import { secretDetectRule } from '../rules/secret-detect';
import { keywordDenyRule } from '../rules/keyword-deny';
import { topicFenceRule } from '../rules/topic-fence';
import { injectionHeuristicRule } from '../rules/injection-heuristic';

// Block-capable rule (keyword-deny) runs before mask-only rules so a block
// short-circuits the pipeline before later mask rules transform the text.
export const INPUT_RULE_ORDER: Rule[] = [
  keywordDenyRule,
  piiRedactRule,
  secretDetectRule,
  topicFenceRule,
  injectionHeuristicRule,
];

export async function evaluateRule(rule: Rule, text: string, ctx: RuleContext): Promise<RuleFinding> {
  try {
    return await rule.evaluate(text, ctx);
  } catch (err) {
    return {
      matched: false,
      action: 'warn',
      reason: `${rule.id}-error`,
      flagsSuspicion: false,
      degraded: true,
    };
  }
}
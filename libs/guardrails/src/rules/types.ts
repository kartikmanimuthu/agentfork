import type { GuardrailsConfig } from '../config/schema';

export type GuardrailAction = 'mask' | 'block' | 'warn';

export interface RuleFinding {
  matched: boolean;
  action: GuardrailAction;
  /** Present when the rule transformed the text (mask). */
  maskedText?: string;
  reason?: string;
  /** True when this finding is a heuristic signal worth escalating to the LLM judge. */
  flagsSuspicion?: boolean;
  /** True when the rule threw internally and degraded to a fail-open warn. */
  degraded?: boolean;
}

export interface RuleContext {
  config: GuardrailsConfig;
  tenantId: string;
  agentId: string;
  agentVersionId?: string;
  phase: 'input' | 'output';
}

export interface Rule {
  id: string;
  phase: 'input' | 'output';
  evaluate(text: string, ctx: RuleContext): Promise<RuleFinding> | RuleFinding;
}
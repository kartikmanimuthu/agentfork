import type { ModelMessage } from 'ai';
import type { GuardrailsConfig } from '../config/schema';
import type { GuardrailAction } from '../rules/types';

export interface GuardrailContext {
  config: GuardrailsConfig;
  tenantId: string;
  agentId: string;
  agentVersionId?: string;
  /** Prisma client for audit writes; optional for pure rule evaluation. */
  db?: unknown;
}

export interface GuardrailDecision {
  ruleId: string;
  action: GuardrailAction;
  reason?: string;
  flagsSuspicion?: boolean;
  degraded?: boolean;
}

export interface GuardrailResult {
  decision: 'pass' | 'mask' | 'block';
  maskedMessages?: ModelMessage[];
  refusalMessage?: string;
  triggered: GuardrailDecision[];
  degraded: boolean;
}
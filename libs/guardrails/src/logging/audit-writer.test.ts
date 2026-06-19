import { describe, it, expect, vi } from 'vitest';
import { logGuardrailDecision } from './audit-writer';
import { defaultGuardrailsConfig } from '../config/schema';
import type { GuardrailResult } from '../engine/types';

vi.mock('@chatbot/shared', async () => {
  const actual = await vi.importActual('@chatbot/shared');
  return {
    ...(actual as any),
    AuditService: { logResourceAction: vi.fn(async () => {}) },
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

const ctx = { config: defaultGuardrailsConfig(), tenantId: 't1', agentId: 'a1', agentVersionId: 'v1' };

describe('logGuardrailDecision', () => {
  it('writes an audit log for a block', async () => {
    const { AuditService } = await import('@chatbot/shared');
    const result: GuardrailResult = { decision: 'block', refusalMessage: 'no', triggered: [{ ruleId: 'keyword-deny', action: 'block', reason: 'banned-phrase' }], degraded: false };
    await logGuardrailDecision({ ctx, result, executionId: 'e1' });
    expect(AuditService.logResourceAction).toHaveBeenCalled();
  });

  it('does not write for a pass when logFlags is false', async () => {
    const { AuditService } = await import('@chatbot/shared');
    (AuditService.logResourceAction as any).mockClear();
    const result: GuardrailResult = { decision: 'pass', triggered: [], degraded: false };
    await logGuardrailDecision({ ctx, result });
    expect(AuditService.logResourceAction).not.toHaveBeenCalled();
  });

  it('writes for a flag when logFlags is true', async () => {
    const { AuditService } = await import('@chatbot/shared');
    (AuditService.logResourceAction as any).mockClear();
    ctx.config.audit.logFlags = true;
    const result: GuardrailResult = { decision: 'pass', triggered: [{ ruleId: 'llm-judge', action: 'warn', reason: 'judge:toxicity' }], degraded: false };
    await logGuardrailDecision({ ctx, result });
    expect(AuditService.logResourceAction).toHaveBeenCalled();
  });
});
import { AuditService, createLogger } from '@chatbot/shared';
import type { GuardrailContext, GuardrailResult } from '../engine/types';

const logger = createLogger('guardrail:audit');

/**
 * Write an `AuditLog` row for a guardrail block (always) or a flag/warn
 * decision (only when `config.audit.logFlags` is enabled).
 *
 * Fail-open (adaptation #2): this function NEVER rejects. A top-level
 * try/catch backstop wraps the entire body so that any unexpected error —
 * including a malformed `audit` section in a user-supplied config — is logged
 * at `error` severity with structured Pino context and swallowed. An inner
 * try/catch wraps the `AuditService.logResourceAction` call specifically and
 * logs the audit-write failure. Audit can never break the chat route.
 */
export async function logGuardrailDecision(args: {
  ctx: GuardrailContext;
  result: GuardrailResult;
  sessionId?: string;
  executionId?: string;
}): Promise<void> {
  const { ctx, result, sessionId, executionId } = args;
  const cfg = ctx.config;

  try {
    const hasBlock = result.triggered.some((t) => t.action === 'block');
    const hasFlag = result.triggered.some((t) => t.action === 'warn');
    // Optional-chain `cfg.audit?.logFlags` — `audit` may be absent/malformed in
    // a user-supplied config; never let the guard itself throw out of the
    // inner block (the top-level backstop still catches it if it does).
    if (!hasBlock && !(hasFlag && cfg.audit?.logFlags)) return;

    // Adaptation #1: `AuditService.logResourceAction` narrows `status` to
    // 'success' | 'error' | 'warning' (no 'info'). Flag decisions are allowed
    // through, so from the audit standpoint the turn succeeded — use
    // 'success' and let `severity: 'low'` carry the informational weight.
    try {
      await AuditService.logResourceAction({
        action: result.decision === 'block' ? 'guardrail_blocked' : 'guardrail_flagged',
        resourceType: 'agent',
        resourceId: ctx.agentId,
        resourceName: `agent:${ctx.agentId}`,
        status: result.decision === 'block' ? 'warning' : 'success',
        details: result.triggered.map((t) => `${t.ruleId}:${t.reason ?? t.action}`).join(', '),
        user: 'system',
        userType: 'system',
        tenantId: ctx.tenantId,
        severity: result.degraded ? 'high' : result.decision === 'block' ? 'medium' : 'low',
        source: 'agent',
        eventType: 'agent.guardrail',
        metadata: {
          agentVersionId: ctx.agentVersionId,
          sessionId,
          executionId,
          decisions: result.triggered,
          degraded: result.degraded,
        },
      });
    } catch (err) {
      // Inner catch: audit-write failure (non-fatal).
      logger.error(
        { errorMessage: (err as Error).message },
        'Audit write failed (non-fatal)',
      );
    }
  } catch (err) {
    // Top-level backstop: any unexpected error (e.g. malformed config shape).
    // `logGuardrailDecision` must NEVER reject.
    logger.error(
      {
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        errorMessage: (err as Error).message,
      },
      'logGuardrailDecision failed (non-fatal)',
    );
  }
}
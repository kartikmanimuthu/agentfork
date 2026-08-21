/**
 * gateway-service.ts — the inbound half, executed inside the HTTP request.
 *
 * Does the minimum before acking: verify the signature, normalize the payload,
 * persist a run, enqueue it. Execution and all outbound messaging happen in the
 * `claw-gateway-run` worker job, so this path stays well inside Slack's ~3s ack
 * budget no matter how long the actual task takes.
 *
 * `enqueue` is injected rather than imported so this library never depends on
 * pg-boss — the caller (Mission Control) owns the queue client.
 */

import { createLogger } from '@chatbot/shared';
import { getConnectorRegistry } from '../connectors/registry';
import { getRunService } from './run-service';
import { isTerminalStatus, type ChannelAdapter, type GatewayMessage, type ReplyAction } from './types';
import type { ChannelType } from '../connectors/types';

const logger = createLogger('claw-studio:gateway:inbound');

/** Thrown by an adapter when no tenant owns the inbound platform identifier. */
export class GatewayTenantUnresolvedError extends Error {
  constructor(channel: string) {
    super(`No tenant is connected for this ${channel} request.`);
    this.name = 'GatewayTenantUnresolvedError';
  }
}

/** Thrown by an adapter when a payload it signed for isn't one it can act on. */
export class GatewayUnsupportedPayloadError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'GatewayUnsupportedPayloadError';
  }
}

export interface GatewayJobPayload {
  runId: string;
  tenantId: string;
  /** `cancel` is dashboard-only; channels only ever send the three ReplyActions. */
  action?: ReplyAction | 'cancel';
  content?: string;
}

export type EnqueueRunFn = (payload: GatewayJobPayload) => Promise<void>;

export interface GatewayDeps {
  enqueue: EnqueueRunFn;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * `POST /api/gateway/{channel}` in full. Returns the response to send back to
 * the platform — the adapter's own ack on the happy path.
 */
export async function handleInbound(
  channel: string,
  req: Request,
  deps: GatewayDeps,
): Promise<Response> {
  const registry = getConnectorRegistry();
  if (!registry.has(channel)) {
    logger.warn({ channel }, 'Inbound request for an unregistered channel');
    return json({ error: 'Unknown channel' }, 404);
  }
  const adapter = registry.get(channel) as ChannelAdapter;

  try {
    // Platform handshakes answer before any tenant-scoped check, because there
    // is no tenant to resolve yet (Slack's url_verification carries no team id).
    if (adapter.preflight) {
      const handshake = await adapter.preflight(req);
      if (handshake) {
        logger.info({ channel }, 'Answered platform handshake');
        return handshake;
      }
    }

    if (!(await adapter.validateRequest(req))) {
      logger.warn({ channel }, 'Inbound request failed signature validation');
      return json({ error: 'Invalid signature' }, 401);
    }

    let message: GatewayMessage;
    try {
      message = await adapter.parseInbound(req);
    } catch (error) {
      if (error instanceof GatewayTenantUnresolvedError) {
        logger.warn({ channel }, 'Inbound request has no linked tenant');
        return json({ error: error.message }, 404);
      }
      if (error instanceof GatewayUnsupportedPayloadError) {
        logger.info({ channel, detail: error.message }, 'Ignoring unsupported inbound payload');
        return json({ ok: true, ignored: error.message }, 200);
      }
      throw error;
    }

    // A disabled connector must not accept work even though its credentials
    // still verify — the toggle is the tenant's off switch.
    const config = await adapter.getConfig(message.tenantId);
    if (!config?.enabled) {
      logger.warn({ channel, tenantId: message.tenantId }, 'Inbound request for a disabled connector');
      return json({ error: 'This channel is not enabled.' }, 403);
    }

    if (message.replyContext) {
      return await handleResume(adapter, req, message, deps);
    }

    if (!message.taskDescription.trim()) {
      return json({ error: 'Nothing to do — the message was empty.' }, 400);
    }

    const run = await getRunService().create({
      tenantId: message.tenantId,
      source: message.channelType,
      taskDescription: message.taskDescription,
      trigger: message.channelMeta,
      userId: message.userId,
    });

    // Enqueue before acking: if the queue is down, fail loudly rather than
    // promising the user a run that will never execute.
    await deps.enqueue({ runId: run.runId, tenantId: run.tenantId });

    logger.info(
      { channel, tenantId: run.tenantId, runId: run.runId },
      'Inbound request accepted and queued',
    );
    return await adapter.sendAck(req, run.runId);
  } catch (error) {
    logger.error({ error, channel }, 'Gateway inbound handling failed');
    return json({ error: 'Internal server error' }, 500);
  }
}

/**
 * A HIL reply (button press, thread reply) re-enters the same inbound route and
 * is disambiguated by `replyContext`, so there is no separate endpoint to
 * secure. Trust comes from the adapter's signature check, which already ran.
 */
async function handleResume(
  adapter: ChannelAdapter,
  req: Request,
  message: GatewayMessage,
  deps: GatewayDeps,
): Promise<Response> {
  const reply = message.replyContext!;
  const runs = getRunService();
  const run = await runs.get(reply.runId);

  if (!run) {
    logger.warn({ runId: reply.runId, channel: adapter.channelType }, 'Resume for unknown run');
    return json({ error: 'That run no longer exists.' }, 404);
  }

  // The run id travels through channel payloads, so confirm it belongs to the
  // tenant the signature resolved to. Without this, a valid request from one
  // workspace could drive another tenant's run.
  if (run.tenantId !== message.tenantId) {
    logger.error(
      { runId: run.runId, requestTenantId: message.tenantId, ownerTenantId: run.tenantId },
      'Resume attempted across tenants — rejected',
    );
    return json({ error: 'That run no longer exists.' }, 404);
  }

  if (isTerminalStatus(run.status)) {
    logger.info({ runId: run.runId, status: run.status }, 'Resume for an already-finished run');
    return await adapter.sendAck(req, run.runId);
  }

  const expected: Record<ReplyAction, string | null> = {
    approve: 'awaiting_approval',
    approve_always: 'awaiting_approval',
    reject: 'awaiting_approval',
    clarification_response: 'awaiting_input',
  };
  const required = expected[reply.action];
  if (required && run.status !== required) {
    logger.warn(
      { runId: run.runId, action: reply.action, status: run.status, required },
      'Resume action does not match the run state — ignoring',
    );
    return await adapter.sendAck(req, run.runId);
  }

  if (reply.action === 'clarification_response' && !reply.content?.trim()) {
    return json({ error: 'Reply was empty.' }, 400);
  }

  await deps.enqueue({
    runId: run.runId,
    tenantId: run.tenantId,
    action: reply.action,
    content: reply.content,
  });

  logger.info(
    { runId: run.runId, channel: adapter.channelType, action: reply.action },
    'Resume queued',
  );
  return await adapter.sendAck(req, run.runId);
}

/** Channels the gateway can currently accept inbound traffic for. */
export function gatewayChannels(): ChannelType[] {
  return getConnectorRegistry()
    .list()
    .filter((c): c is ChannelAdapter => typeof (c as ChannelAdapter).parseInbound === 'function')
    .map((c) => c.channelType);
}

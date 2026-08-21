/**
 * POST /api/gateway/{channel} — the single inbound endpoint for every channel.
 *
 * Intentionally has no session check: the caller is Slack or Telegram, not a
 * logged-in user, so authentication is the adapter's signature/secret
 * verification inside handleInbound. Middleware excludes /api, so nothing
 * redirects this to a login page.
 *
 * Slash commands, button presses and thread replies all arrive here; the adapter
 * decides which is which. Everything slow happens in the claw-gateway-run
 * worker job, so this handler stays inside Slack's ~3s ack budget.
 */

import { NextRequest } from 'next/server';
import { createLogger } from '@chatbot/shared';
import { handleInbound } from '@chatbot/claw-studio';
import { enqueueGatewayRun } from '@/lib/queue';

const logger = createLogger('mission-control:api:gateway');

export async function POST(request: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  let channel = 'unknown';
  try {
    ({ channel } = await params);
    return await handleInbound(channel, request, { enqueue: enqueueGatewayRun });
  } catch (error) {
    logger.error({ error, channel }, 'Gateway route failed');
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

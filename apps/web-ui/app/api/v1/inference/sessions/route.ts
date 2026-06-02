import { NextRequest, NextResponse } from 'next/server';
import {
  getPrismaClient,
  InferenceSessionService,
  createLogger,
} from '@chatbot/shared';
import { validateInferenceApiKey } from '../lib/auth';

const logger = createLogger('api:inference:sessions');

/**
 * POST /api/v1/inference/sessions
 *
 * Create a new InferenceSession. Body fields:
 *   - name?         — display label
 *   - channel?      — defaults to 'API'
 *   - channelMetadata? — integrator-supplied JSON (phone, channel-id, end-user-id, etc.)
 *   - idleMinutes?  — override the 30-min default idle timeout
 */
export async function POST(req: NextRequest) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) {
    return authResult.response;
  }

  const { tenantId, apiKeyId, agentId } = authResult.auth;

  try {
    const body = await req.json();
    const { name, channel, channelMetadata, idleMinutes, visitorId, visitorName, visitorEmail, metadata } = body as {
      name?: string;
      channel?: string;
      channelMetadata?: Record<string, unknown> | null;
      idleMinutes?: number;
      visitorId?: string;
      visitorName?: string;
      visitorEmail?: string;
      metadata?: Record<string, unknown>;
    };

    const effectiveChannelMetadata = channelMetadata ?? (visitorId ? { visitorId, visitorName, visitorEmail, ...metadata } : null);
    const effectiveChannel = channel ?? (visitorId ? 'SDK' : 'API');

    const db = getPrismaClient();
    const service = new InferenceSessionService(db);
    const session = await service.create({
      apiKeyId,
      tenantId,
      agentId,
      name: name ?? visitorName,
      channel: effectiveChannel,
      channelMetadata: effectiveChannelMetadata,
      idleMinutes,
    });

    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message }, 'Failed to create session');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to create session' } },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v1/inference/sessions
 *
 * List active, non-idle-expired sessions for the calling API key.
 */
export async function GET(req: NextRequest) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) {
    return authResult.response;
  }

  const { apiKeyId } = authResult.auth;

  try {
    const db = getPrismaClient();
    const service = new InferenceSessionService(db);
    const sessions = await service.findByApiKeyId(apiKeyId);

    return NextResponse.json(sessions, { status: 200 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ errorMessage: err.message }, 'Failed to list sessions');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to list sessions' } },
      { status: 500 }
    );
  }
}

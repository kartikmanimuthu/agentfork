import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import crypto from 'crypto';

const logger = createLogger('api:transcription:auth');

export interface TranscriptionAuthResult {
  tenantId: string;
  apiKeyId: string;
  jobConfigId: string | null;
  modelId: string | null;
  apiKey: {
    dailyReqLimit: number;
    dailyMinutesLimit: number;
    minuteReqLimit: number;
    webhookUrl: string | null;
    webhookSecret: string | null;
  };
}

/**
 * Validate the Bearer transcription API key (mirrors the inference auth flow):
 * sha256(rawKey) → TranscriptionApiKey lookup, with revoked/expired checks.
 */
export async function validateTranscriptionApiKey(
  req: NextRequest
): Promise<{ success: true; auth: TranscriptionAuthResult } | { success: false; response: NextResponse }> {
  const authHeader = req.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn({ path: req.nextUrl.pathname, hadHeader: !!authHeader }, 'Transcription auth rejected: missing or malformed Authorization header');
    return {
      success: false,
      response: NextResponse.json(
        { error: { type: 'invalid_api_key', message: 'Missing or invalid Authorization header' } },
        { status: 401 }
      ),
    };
  }

  const rawKey = authHeader.slice(7);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  // Never log the raw key or its full hash — a prefix is enough to correlate reports
  // (e.g. "my key starting with sk_abc...") without being able to reconstruct the secret.
  const keyPrefix = rawKey.slice(0, 8);

  const db = getPrismaClient();
  const apiKey = await db.transcriptionApiKey.findFirst({ where: { keyHash } });

  if (!apiKey) {
    logger.warn({ path: req.nextUrl.pathname, keyPrefix }, 'Transcription auth rejected: no matching API key for this hash');
    return {
      success: false,
      response: NextResponse.json(
        { error: { type: 'invalid_api_key', message: 'API key not found' } },
        { status: 401 }
      ),
    };
  }

  if (apiKey.status === 'revoked') {
    logger.warn({ path: req.nextUrl.pathname, tenantId: apiKey.tenantId, apiKeyId: apiKey.id }, 'Transcription auth rejected: API key revoked');
    return {
      success: false,
      response: NextResponse.json(
        { error: { type: 'invalid_api_key', message: 'API key has been revoked' } },
        { status: 401 }
      ),
    };
  }

  if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
    logger.warn(
      { path: req.nextUrl.pathname, tenantId: apiKey.tenantId, apiKeyId: apiKey.id, expiresAt: apiKey.expiresAt },
      'Transcription auth rejected: API key expired'
    );
    return {
      success: false,
      response: NextResponse.json(
        { error: { type: 'invalid_api_key', message: 'API key has expired' } },
        { status: 401 }
      ),
    };
  }

  return {
    success: true,
    auth: {
      tenantId: apiKey.tenantId,
      apiKeyId: apiKey.id,
      jobConfigId: apiKey.jobConfigId,
      modelId: apiKey.modelId,
      apiKey: {
        dailyReqLimit: apiKey.dailyReqLimit,
        dailyMinutesLimit: apiKey.dailyMinutesLimit,
        minuteReqLimit: apiKey.minuteReqLimit,
        webhookUrl: apiKey.webhookUrl,
        webhookSecret: apiKey.webhookSecret,
      },
    },
  };
}

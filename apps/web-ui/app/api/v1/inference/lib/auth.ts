import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient } from '@chatbot/shared';
import crypto from 'crypto';

export interface InferenceAuthResult {
  tenantId: string;
  apiKeyId: string;
  agentId: string;
  apiKey: {
    dailyReqLimit: number;
    dailyTokenLimit: number;
    minuteReqLimit: number;
    webhookUrl: string | null;
    webhookSecret: string | null;
  };
}

export async function validateInferenceApiKey(
  req: NextRequest
): Promise<{ success: true; auth: InferenceAuthResult } | { success: false; response: NextResponse }> {
  const authHeader = req.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
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

  const db = getPrismaClient();
  let apiKey = await db.apiKey.findFirst({
    where: { keyHash },
    include: { agent: true },
  }) as {
    id: string;
    tenantId: string;
    agentId: string;
    status: string;
    expiresAt: Date | null;
    dailyReqLimit: number;
    dailyTokenLimit: number;
    minuteReqLimit: number;
    webhookUrl: string | null;
    webhookSecret: string | null;
  } | null;

  if (!apiKey) {
    apiKey = await db.apiKey.findFirst({
      where: { keyPrefix: rawKey },
      include: { agent: true },
    }) as {
    id: string;
    tenantId: string;
    agentId: string;
    status: string;
    expiresAt: Date | null;
    dailyReqLimit: number;
    dailyTokenLimit: number;
    minuteReqLimit: number;
    webhookUrl: string | null;
    webhookSecret: string | null;
  } | null;
  }

  if (!apiKey) {
    return {
      success: false,
      response: NextResponse.json(
        { error: { type: 'invalid_api_key', message: 'API key not found' } },
        { status: 401 }
      ),
    };
  }

  if (apiKey.status === 'revoked') {
    return {
      success: false,
      response: NextResponse.json(
        { error: { type: 'invalid_api_key', message: 'API key has been revoked' } },
        { status: 401 }
      ),
    };
  }

  if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
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
      agentId: apiKey.agentId,
      apiKey: {
        dailyReqLimit: apiKey.dailyReqLimit,
        dailyTokenLimit: apiKey.dailyTokenLimit,
        minuteReqLimit: apiKey.minuteReqLimit,
        webhookUrl: apiKey.webhookUrl,
        webhookSecret: apiKey.webhookSecret,
      },
    },
  };
}

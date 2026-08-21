import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, TranscriptionApiKeyService, createLogger } from '@chatbot/shared';
import { validateTranscriptionApiKey } from '../lib/auth';

const logger = createLogger('api:transcription:usage');

export async function GET(req: NextRequest) {
  const authResult = await validateTranscriptionApiKey(req);
  if (!authResult.success) return authResult.response;

  const { tenantId, apiKeyId, apiKey: keyLimits } = authResult.auth;

  try {
    const db = getPrismaClient();
    const service = new TranscriptionApiKeyService(tenantId, db);
    const usage = await service.getUsage(apiKeyId);

    return NextResponse.json(
      {
        date: new Date().toISOString().split('T')[0],
        requestCount: usage.requestCount,
        minutesCount: usage.minutesCount,
        requestLimit: keyLimits.dailyReqLimit,
        minutesLimit: keyLimits.dailyMinutesLimit,
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error({ err: error, apiKeyId }, 'Failed to get transcription usage');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to get usage' } },
      { status: 500 }
    );
  }
}

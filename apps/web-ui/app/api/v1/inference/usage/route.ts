import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, QuotaService } from '@chatbot/shared';
import { validateInferenceApiKey } from '../lib/auth';

export async function GET(req: NextRequest) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) {
    return authResult.response;
  }

  const { apiKeyId, apiKey: keyLimits } = authResult.auth;

  try {
    const db = getPrismaClient();
    const quotaService = new QuotaService(apiKeyId, db);
    const usage = await quotaService.getUsage();

    return NextResponse.json({
      date: new Date().toISOString().split('T')[0],
      requestCount: usage.requestCount,
      tokenCount: usage.tokenCount,
      requestLimit: keyLimits.dailyReqLimit,
      tokenLimit: keyLimits.dailyTokenLimit,
    }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to get usage' } },
      { status: 500 }
    );
  }
}

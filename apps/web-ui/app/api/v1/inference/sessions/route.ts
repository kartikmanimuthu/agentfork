import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, InferenceSessionService } from '@chatbot/shared';
import { validateInferenceApiKey } from '../lib/auth';

export async function POST(req: NextRequest) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) {
    return authResult.response;
  }

  const { tenantId, apiKeyId, agentId } = authResult.auth;

  try {
    const body = await req.json();
    const { name, ttlHours } = body;

    const db = getPrismaClient();
    const service = new InferenceSessionService(db);
    const session = await service.create({
      apiKeyId,
      tenantId,
      agentId,
      name,
      ttlHours,
    });

    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to create session' } },
      { status: 500 }
    );
  }
}

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
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to list sessions' } },
      { status: 500 }
    );
  }
}

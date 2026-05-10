import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, InferenceSessionService } from '@chatbot/shared';
import { validateInferenceApiKey } from '../../lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) {
    return authResult.response;
  }

  const { id } = await params;

  try {
    const db = getPrismaClient();
    const service = new InferenceSessionService(db);
    const session = await service.findById(id);

    if (!session) {
      return NextResponse.json(
        { error: { type: 'session_expired', message: 'Session not found or expired' } },
        { status: 410 }
      );
    }

    return NextResponse.json(session, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to get session' } },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) {
    return authResult.response;
  }

  const { id } = await params;

  try {
    const db = getPrismaClient();
    const service = new InferenceSessionService(db);
    await service.delete(id);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Failed to delete session' } },
      { status: 500 }
    );
  }
}

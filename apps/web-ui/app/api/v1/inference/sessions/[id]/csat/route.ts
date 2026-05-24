import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, createLogger, CsatService } from '@chatbot/shared';
import { validateInferenceApiKey } from '../../../lib/auth';

const logger = createLogger('api:inference:sessions:csat');

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await validateInferenceApiKey(req);
  if (!authResult.success) return authResult.response;

  const { id: sessionId } = await params;
  const { apiKeyId } = authResult.auth;

  try {
    const db = getPrismaClient();

    const session = await db.inferenceSession.findFirst({
      where: { id: sessionId, apiKeyId },
    });
    if (!session) {
      return NextResponse.json(
        { error: { type: 'not_found', message: 'Session not found' } },
        { status: 404 }
      );
    }

    const body = await req.json();
    const { rating, comment } = body as { rating: number; comment?: string };

    if (typeof rating !== 'number' || rating < 0 || rating > 5) {
      return NextResponse.json(
        { error: { type: 'validation_error', message: 'Rating must be 0-5' } },
        { status: 400 }
      );
    }

    const widget = await db.sdkWidget.findFirst({ where: { apiKeyId } });
    if (!widget) {
      return NextResponse.json(
        { error: { type: 'not_found', message: 'No widget linked to this API key' } },
        { status: 404 }
      );
    }

    const csatService = new CsatService(db);
    const result = await csatService.submit({ sessionId, sdkWidgetId: widget.id, rating, comment });

    logger.info({ sessionId, rating }, 'CSAT submitted');
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err: err.message, sessionId }, 'CSAT submission failed');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'CSAT submission failed' } },
      { status: 500 }
    );
  }
}

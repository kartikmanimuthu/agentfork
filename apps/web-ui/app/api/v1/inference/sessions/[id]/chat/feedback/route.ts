import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, createLogger, FeedbackService } from '@chatbot/shared';
import { validateInferenceApiKey } from '../../../../lib/auth';

const logger = createLogger('api:inference:sessions:feedback');

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
    const { messageId, rating, comment } = body as {
      messageId: string;
      rating: 'up' | 'down';
      comment?: string;
    };

    if (!messageId || !['up', 'down'].includes(rating)) {
      return NextResponse.json(
        { error: { type: 'validation_error', message: 'messageId and rating (up|down) required' } },
        { status: 400 }
      );
    }

    const message = await db.inferenceSessionMessage.findFirst({
      where: { id: messageId, sessionId },
    });
    if (!message) {
      return NextResponse.json(
        { error: { type: 'not_found', message: 'Message not found in this session' } },
        { status: 404 }
      );
    }

    const feedbackService = new FeedbackService(db);
    const result = await feedbackService.submit({ messageId, sessionId, rating, comment });

    logger.info({ sessionId, messageId, rating }, 'Feedback submitted');
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err: err.message, sessionId }, 'Feedback submission failed');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Feedback submission failed' } },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, ScoreService, createLogger, scoreIngestSchema, ValidationError } from '@chatbot/shared';
import type { ScoreDb } from '@chatbot/shared';
import { validateScoreApiKey } from './lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:v1:scores');

export async function POST(req: NextRequest) {
  try {
    const authResult = await validateScoreApiKey(req);
    if (!authResult.success) return authResult.response;
    const { tenantId } = authResult.auth;

    let raw: unknown;
    try { raw = await req.json(); } catch { return NextResponse.json({ error: { type: 'invalid_body', message: 'Invalid JSON' } }, { status: 422 }); }
    const parsed = scoreIngestSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: { type: 'validation_error', issues: parsed.error.issues } }, { status: 422 });

    const score = await new ScoreService(getPrismaClient() as unknown as ScoreDb).ingest({ ...parsed.data, tenantId });
    return NextResponse.json({ score }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: { type: 'validation_error', issues: error.issues } }, { status: 422 });
    if (error instanceof Error && /not found/i.test(error.message)) return NextResponse.json({ error: { type: 'not_found', message: error.message } }, { status: 404 });
    if (error instanceof Error && /(range|categor|requires)/i.test(error.message)) return NextResponse.json({ error: { type: 'validation_error', message: error.message } }, { status: 422 });
    logger.error({ err: error }, 'Failed to ingest score');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}

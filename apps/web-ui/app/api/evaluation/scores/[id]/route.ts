import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  getPrismaClient,
  ScoreService,
  createLogger,
} from '@chatbot/shared';
import type { ScoreDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:scores:id');

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'Score', authOptions);
    if (authError) return authError;
    const service = new ScoreService(getPrismaClient() as unknown as ScoreDb);
    await service.delete(tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && /not found/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    logger.error({ err: error }, 'Failed to delete score');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

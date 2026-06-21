import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import type PgBoss from 'pg-boss';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:evaluators:run');
const JOB_NAME = 'evaluator-run';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    await authorize('update', 'Evaluator', authOptions);
    const boss: PgBoss | undefined = (globalThis as any).__pgBoss__;
    if (!boss) throw new Error('pg-boss not initialized');
    const jobId = await boss.send(JOB_NAME, { evaluatorId: id, tenantId, limit: 100 });
    logger.info({ tenantId, evaluatorId: id, jobId }, 'Enqueued evaluator run');
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (error) {
    logger.error({ err: error, action: 'enqueue evaluator run' }, 'Failed to enqueue evaluator run');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import type PgBoss from 'pg-boss';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:experiments:run');
const JOB_NAME = 'experiment-run';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    await authorize('update', 'Experiment', authOptions);
    const boss: PgBoss | undefined = (globalThis as any).__pgBoss__;
    if (!boss) throw new Error('pg-boss not initialized');
    const jobId = await boss.send(JOB_NAME, { experimentId: id, tenantId });
    logger.info({ tenantId, experimentId: id, jobId }, 'Enqueued experiment run');
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (error) {
    logger.error({ err: error, action: 'enqueue experiment run' }, 'Failed to enqueue experiment run');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

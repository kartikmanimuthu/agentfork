import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createLogger } from '@chatbot/shared';
import { getRunService } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:runs:detail');

export async function GET(_request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  let runId = 'unknown';
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    ({ runId } = await params);
    const tenantId = session.studio.tenantId;

    const runs = getRunService();
    // Tenant-scoped read: unlike the channel path, nothing here verified a
    // platform signature, so ownership is checked explicitly.
    const run = await runs.get(runId, tenantId);
    if (!run) {
      return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 });
    }

    const events = await runs.listEvents(runId, tenantId);
    return NextResponse.json({ success: true, data: { run, events } });
  } catch (error) {
    logger.error({ error, runId }, 'Failed to fetch run');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

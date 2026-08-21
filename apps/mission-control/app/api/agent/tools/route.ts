import { NextResponse } from 'next/server';
import { createLogger } from '@chatbot/shared';
import { UnauthenticatedError, resolveClawForSession } from '@/lib/claw-resolver';
import { collectToolGroups } from '@/lib/agent-tools';

const logger = createLogger('mission-control:api:agent:tools');

/** What tools Claw actually has bound, grouped by source. */
export async function GET() {
  try {
    const { tenantId } = await resolveClawForSession();
    return NextResponse.json({ success: true, data: await collectToolGroups(tenantId) });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to list agent tools');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

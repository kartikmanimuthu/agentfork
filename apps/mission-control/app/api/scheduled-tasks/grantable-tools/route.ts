import { NextResponse } from 'next/server';
import { createLogger } from '@chatbot/shared';
import { classifyTool } from '@chatbot/claw-studio';
import { UnauthenticatedError, resolveClawForSession } from '@/lib/claw-resolver';
import { collectToolGroups } from '@/lib/agent-tools';

const logger = createLogger('mission-control:api:scheduled-tasks:grantable-tools');

/**
 * The tools a scheduled task can be granted. Only mutative ones — read-only tools
 * never hit the approval gate, so listing them would be noise in the picker.
 */
export async function GET() {
  try {
    const { tenantId } = await resolveClawForSession();
    const groups = await collectToolGroups(tenantId);

    const grantable = groups
      .map((group) => ({
        source: group.source,
        displayName: group.displayName,
        tools: group.tools.filter((tool) => classifyTool(tool.name).isMutative),
      }))
      .filter((group) => group.tools.length > 0);

    return NextResponse.json({ success: true, data: grantable });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to list grantable tools');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

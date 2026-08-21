import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@chatbot/shared';
import { WorkspaceFileService, isWorkspaceSlug } from '@chatbot/claw-studio';
import { UnauthenticatedError, resolveClawForSession } from '@/lib/claw-resolver';

const logger = createLogger('mission-control:api:files:revisions');

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    if (!isWorkspaceSlug(slug)) {
      return NextResponse.json({ success: false, error: 'Unknown workspace file' }, { status: 404 });
    }
    const { tenantId, clawId } = await resolveClawForSession();
    const revisions = await new WorkspaceFileService(tenantId, clawId).revisions(slug);
    return NextResponse.json({ success: true, data: revisions });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, slug }, 'Failed to list workspace file revisions');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

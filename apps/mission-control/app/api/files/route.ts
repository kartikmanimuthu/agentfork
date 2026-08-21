import { NextResponse } from 'next/server';
import { createLogger } from '@chatbot/shared';
import { SLUG_CHAR_CAPS, SLUG_LABELS, WorkspaceFileService } from '@chatbot/claw-studio';
import { UnauthenticatedError, resolveClawForSession } from '@/lib/claw-resolver';

const logger = createLogger('mission-control:api:files');

export async function GET() {
  try {
    const { tenantId, clawId } = await resolveClawForSession();
    const service = new WorkspaceFileService(tenantId, clawId);
    // Seed here too: the editor is often the first place a tenant lands, and an
    // empty tab set with no explanation is worse than the seeded prompts.
    await service.seed();
    // Template improvements reach existing tenants here; only touches files nobody
    // has edited (version === 1).
    await service.reseedUnedited();
    const files = await service.list();
    return NextResponse.json({
      success: true,
      data: files.map((file) => ({
        ...file,
        label: SLUG_LABELS[file.slug],
        charCap: SLUG_CHAR_CAPS[file.slug],
      })),
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to list workspace files');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

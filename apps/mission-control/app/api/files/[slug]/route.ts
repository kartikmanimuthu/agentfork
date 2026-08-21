import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { WorkspaceFileService, WorkspaceFileTooLargeError, isWorkspaceSlug } from '@chatbot/claw-studio';
import { UnauthenticatedError, resolveClawForSession } from '@/lib/claw-resolver';

const logger = createLogger('mission-control:api:files:slug');

// The real per-slug cap is enforced in the service (SLUG_CHAR_CAPS); this is a
// coarse boundary guard so an enormous body is rejected before any DB work.
const putSchema = z.object({ content: z.string().max(20_000) });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    if (!isWorkspaceSlug(slug)) {
      return NextResponse.json({ success: false, error: 'Unknown workspace file' }, { status: 404 });
    }
    const { tenantId, clawId } = await resolveClawForSession();
    const file = await new WorkspaceFileService(tenantId, clawId).read(slug);
    if (!file) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: file });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error, slug }, 'Failed to read workspace file');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    if (!isWorkspaceSlug(slug)) {
      return NextResponse.json({ success: false, error: 'Unknown workspace file' }, { status: 404 });
    }
    const parsed = putSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }
    const { tenantId, clawId } = await resolveClawForSession();
    const file = await new WorkspaceFileService(tenantId, clawId)
      .write(slug, parsed.data.content, { updatedBy: 'user' });
    logger.info({ tenantId, clawId, slug, version: file.version }, 'Workspace file saved');
    return NextResponse.json({ success: true, data: file });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof WorkspaceFileTooLargeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    logger.error({ error, slug }, 'Failed to save workspace file');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

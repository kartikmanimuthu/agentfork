import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import {
  WorkspaceFileNotFoundError, WorkspaceFileService, isWorkspaceSlug,
} from '@chatbot/claw-studio';
import { UnauthenticatedError, resolveClawForSession } from '@/lib/claw-resolver';

const logger = createLogger('mission-control:api:files:restore');

const versionSchema = z.coerce.number().int().positive();

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; version: string }> },
) {
  const { slug, version } = await params;
  try {
    if (!isWorkspaceSlug(slug)) {
      return NextResponse.json({ success: false, error: 'Unknown workspace file' }, { status: 404 });
    }
    const parsed = versionSchema.safeParse(version);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid version' }, { status: 400 });
    }
    const { tenantId, clawId } = await resolveClawForSession();
    const file = await new WorkspaceFileService(tenantId, clawId).restore(slug, parsed.data);
    logger.info(
      { tenantId, clawId, slug, restoredFrom: parsed.data, version: file.version },
      'Workspace file restored',
    );
    return NextResponse.json({ success: true, data: file });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof WorkspaceFileNotFoundError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 404 });
    }
    logger.error({ error, slug, version }, 'Failed to restore workspace file revision');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

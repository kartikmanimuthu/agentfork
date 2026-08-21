import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  TranscriptionJobConfigService,
  TranscriptionJobVersionService,
  createLogger,
} from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:transcription:job-configs:publish');

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TranscriptionJobConfig', authOptions);
    if (authError) return authError;

    const { id, versionId } = await params;
    const configService = new TranscriptionJobConfigService(tenantId);
    const config = await configService.findById(id);
    if (!config) return NextResponse.json({ error: 'Job config not found' }, { status: 404 });

    const versionService = new TranscriptionJobVersionService();
    const version = await versionService.findById(versionId);
    if (!version || version.jobConfigId !== id) return NextResponse.json({ error: 'Version not found' }, { status: 404 });

    await versionService.publish(versionId);
    // Activate the job config. Note: `versionId` here is a TranscriptionJobVersion id (a
    // snapshot of this job's own settings) — it must NOT be written to
    // TranscriptionJobConfig.versionId, which is a different foreign key entirely (it points
    // at a TranscriptionModelVersion, i.e. which *provider* version the job is pinned to).
    const updated = await configService.update(id, { status: 'active' });
    logger.info({ tenantId, jobConfigId: id, versionId }, 'Published transcription job version');
    return NextResponse.json({ version, config: updated });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to publish transcription job version');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

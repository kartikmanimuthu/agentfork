import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  TranscriptionJobConfigService,
  TranscriptionModelService,
  createLogger,
} from '@chatbot/shared';
import { transcribeAudio } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('api:transcription:job-configs:playground');

const testSchema = z.object({
  audioBase64: z.string().min(1, 'Audio base64 is required'),
  mimeType: z.string().min(1, 'mimeType is required'),
  fileName: z.string().optional(),
  // Ephemeral test-time overrides — do not persist to the job config.
  modelId: z.string().optional(),
  language: z.string().optional(),
  diarize: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'TranscriptionJobConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = testSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const configService = new TranscriptionJobConfigService(tenantId);
    const jobConfig = await configService.findById(id);
    if (!jobConfig) return NextResponse.json({ error: 'Job config not found' }, { status: 404 });

    const overrideModelId = parsed.data.modelId;
    const effectiveModelId = overrideModelId ?? jobConfig.modelId ?? undefined;
    // A version pinned in the saved job config belongs to the job's own model — don't
    // carry it over when the caller is testing against a different model.
    const effectiveVersionId = overrideModelId && overrideModelId !== jobConfig.modelId ? undefined : jobConfig.versionId ?? undefined;

    const modelConfig = await new TranscriptionModelService(tenantId).getConfig(effectiveModelId, effectiveVersionId);
    if (!modelConfig) {
      return NextResponse.json({ error: 'No transcription model configured for this job' }, { status: 400 });
    }

    const audio = Buffer.from(parsed.data.audioBase64, 'base64');
    const jobConfigJson = (jobConfig.config ?? {}) as Record<string, unknown>;
    const language = parsed.data.language ?? (jobConfigJson.language as string | undefined);
    const diarize = parsed.data.diarize ?? (jobConfigJson.diarize as boolean | undefined);

    const result = await transcribeAudio({
      endpointUrl: modelConfig.endpointUrl,
      contract: (modelConfig.contract as 'custom' | 'openai-audio' | undefined) ?? 'custom',
      model: modelConfig.modelId ?? null,
      credentials: modelConfig.credentials,
      audio,
      mimeType: parsed.data.mimeType,
      fileName: parsed.data.fileName,
      language,
      diarize,
    });

    logger.info({ tenantId, jobConfigId: id, latencyMs: Date.now() - startedAt }, 'Playground transcription test completed');
    return NextResponse.json({
      text: result.text,
      language: result.language ?? null,
      durationSec: result.durationSec ?? null,
      segments: result.segments ?? null,
      outputS3Key: null,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ err, latencyMs: Date.now() - startedAt }, 'Playground transcription test failed');
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

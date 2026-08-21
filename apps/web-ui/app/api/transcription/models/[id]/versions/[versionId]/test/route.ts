import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, TranscriptionModelService, createLogger } from '@chatbot/shared';
import { transcribeAudio } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:transcription:models:versions:test');

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'TranscriptionModel', authOptions);
    if (authError) return authError;

    const { id, versionId } = await params;

    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Use multipart/form-data with a "file" field' }, { status: 400 });
    }
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'multipart/form-data must include a "file" field' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json({ error: 'Empty file' }, { status: 400 });
    }
    const language = (form.get('language') as string) || undefined;
    const diarize = form.get('diarize') === 'true';

    const config = await new TranscriptionModelService(tenantId).getConfig(id, versionId);
    if (!config) {
      return NextResponse.json({ error: 'Provider or version not found' }, { status: 404 });
    }

    const result = await transcribeAudio({
      endpointUrl: config.endpointUrl,
      contract: config.contract as 'custom' | 'openai-audio',
      model: config.modelId,
      credentials: config.credentials,
      audio: buffer,
      mimeType: file.type || 'application/octet-stream',
      fileName: file.name,
      language,
      diarize,
    });

    logger.info({ tenantId, modelId: id, versionId, stub: result.stub ?? false }, 'Version test transcription complete');

    return NextResponse.json({
      text: result.text,
      language: result.language ?? null,
      durationSec: result.durationSec ?? null,
      segments: result.segments ?? null,
      stub: result.stub ?? false,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ err, errorMessage: err.message }, 'Version test transcription failed');
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

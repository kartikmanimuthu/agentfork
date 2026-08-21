import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionTenantId, authorize, createLogger, LlmProviderService } from '@chatbot/shared';
import { generateEmbedding, createLLMProvider } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents:embedding-check');

const bodySchema = z.object({
  embeddingModel: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 },
      );
    }

    const { embeddingModel } = parsed.data;

    const providerService = new LlmProviderService(tenantId);
    const providers = await providerService.list();
    const owning = providers.find((provider) => {
      const discovered =
        (provider.models as { models?: Array<{ id: string }> } | null)?.models ?? [];
      return (
        discovered.some((model) => model.id === embeddingModel) ||
        provider.embeddingModel === embeddingModel
      );
    });

    if (!owning) {
      logger.warn(
        { tenantId, embeddingModel },
        'Embedding model not offered by any configured provider',
      );
      return NextResponse.json(
        { ok: false, error: 'That embedding model is not offered by any provider you have configured.' },
        { status: 400 },
      );
    }

    const config = await providerService.getConfigById(owning.id);
    const provider = config ? createLLMProvider({ ...config, embeddingModel }) : undefined;
    const vector = await generateEmbedding('semantic cache validation probe', provider);

    if (!Array.isArray(vector) || vector.length === 0) {
      logger.warn({ tenantId, embeddingModel }, 'Embedding model returned an empty vector');
      return NextResponse.json(
        { ok: false, error: 'That model did not return an embedding. Pick a different model.' },
        { status: 400 },
      );
    }

    logger.info({ tenantId, embeddingModel, dimensions: vector.length }, 'Embedding model validated');
    return NextResponse.json({ ok: true, dimensions: vector.length });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (error.message.includes('Unauthenticated')) {
      return NextResponse.json({ ok: false, error: 'Unauthenticated' }, { status: 401 });
    }
    if (error.message.includes('Unauthorized')) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    }
    logger.error(
      { errorMessage: error.message, errorStack: error.stack },
      'Embedding check failed',
    );
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
}

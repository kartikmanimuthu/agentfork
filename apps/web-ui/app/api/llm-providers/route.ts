import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, LlmProviderService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  provider: z.enum(['bedrock', 'openai']),
  chatModel: z.string().optional().nullable(),
  embeddingModel: z.string().optional().nullable(),
  embeddingDimensions: z.number().optional().nullable(),
  baseUrl: z.string().optional().nullable(),
  apiKey: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'LlmProviders', authOptions);
    if (authError) return authError;

    const service = new LlmProviderService(tenantId);
    const providers = await service.list();

    return NextResponse.json(providers);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'LlmProviders', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      );
    }

    const service = new LlmProviderService(tenantId);
    const provider = await service.create(parsed.data);

    return NextResponse.json(provider, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'Provider with this name already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

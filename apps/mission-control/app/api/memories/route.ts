import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { getMemoryService } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:memories');

const KIND_ENUM = z.enum(['SEMANTIC', 'EPISODIC', 'PROCEDURAL']);
const SORT_ENUM = z.enum(['key', 'createdAt', 'updatedAt', 'expiresAt']);

const querySchema = z.object({
  kind: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter((k): k is z.infer<typeof KIND_ENUM> => KIND_ENUM.safeParse(k).success) : undefined)),
  search: z.string().optional(),
  sort: SORT_ENUM.optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }

    const params = new URL(request.url).searchParams;
    const parsed = querySchema.safeParse({
      kind: params.get('kind') ?? undefined,
      search: params.get('search') ?? undefined,
      sort: params.get('sort') ?? undefined,
      dir: params.get('dir') ?? undefined,
      limit: params.get('limit') ?? undefined,
      page: params.get('page') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const { memories, total } = await getMemoryService().listMemories({
      tenantId: session.studio.tenantId,
      kinds: parsed.data.kind,
      search: parsed.data.search,
      sortBy: parsed.data.sort,
      sortDir: parsed.data.dir,
      limit: parsed.data.limit ?? 500,
      page: parsed.data.page ?? 1,
    });

    return NextResponse.json({ success: true, data: memories, total });
  } catch (error) {
    logger.error({ error }, 'Failed to list memories');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

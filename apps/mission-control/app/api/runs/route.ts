import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { getRunService, type RunSource, type RunStatus } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:runs');

const querySchema = z.object({
  status: z
    .enum(['queued', 'in_progress', 'awaiting_input', 'awaiting_approval', 'completed', 'failed', 'cancelled'])
    .optional(),
  source: z.enum(['slack', 'telegram', 'discord', 'dashboard']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    const tenantId = session.studio.tenantId;

    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid query' },
        { status: 400 },
      );
    }

    const runs = getRunService();
    const [page, counts] = await Promise.all([
      runs.list({
        tenantId,
        status: parsed.data.status as RunStatus | undefined,
        source: parsed.data.source as RunSource | undefined,
        limit: parsed.data.limit,
        cursor: parsed.data.cursor,
      }),
      runs.countsByStatus(tenantId),
    ]);

    return NextResponse.json({ success: true, ...page, counts });
  } catch (error) {
    logger.error({ error }, 'Failed to list runs');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

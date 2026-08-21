import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { getDashboard, DASHBOARD_RANGES, DEFAULT_DASHBOARD_RANGE } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:dashboard');

const rangeSchema = z.enum(DASHBOARD_RANGES as [string, ...string[]]).catch(DEFAULT_DASHBOARD_RANGE);

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }

    // An unknown range falls back to the default rather than 400-ing — the value
    // only widens a read window, so there's nothing to protect against here.
    const range = rangeSchema.parse(request.nextUrl.searchParams.get('range') ?? undefined);
    const data = await getDashboard(session.studio.tenantId, range as never);

    logger.info({ tenantId: session.studio.tenantId, range }, 'Dashboard loaded');
    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.error({ error }, 'Failed to load dashboard');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

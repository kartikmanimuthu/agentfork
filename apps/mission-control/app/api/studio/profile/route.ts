import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { StudioService, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:studio:profile');

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }

    const studio = await new StudioService(session.studio.tenantId, getPrismaClient()).getForTenant();
    if (!studio) {
      return NextResponse.json({ success: false, error: 'Studio not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: studio });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch studio profile');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

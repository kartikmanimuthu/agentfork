import { getServerSession } from 'next-auth';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:claw');

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.clawId) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    const db = getPrismaClient();
    const claw = await db.claw.findFirst({
      where: { id: session.studio.clawId },
      select: { id: true, name: true, autoApprove: true, createdAt: true },
    });
    return new Response(JSON.stringify({ claw, studioId: session.studio.studioId }), { status: 200 });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch Claw summary');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}

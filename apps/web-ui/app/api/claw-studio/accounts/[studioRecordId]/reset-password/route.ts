/**
 * Resets one account's password by studio record id.
 *
 * The tenant-scoped ../../reset-password route can only reach the studio in the
 * user's CURRENT tenant, so it cannot reset any of their other accounts — those
 * live in other tenants by design. `resetPasswordForUser` re-checks membership
 * of the target studio's tenant before doing anything, so a studio id belonging
 * to someone else is indistinguishable from one that does not exist.
 */
import { NextRequest } from 'next/server';
import {
  getSessionTenantId,
  getSessionUserId,
  getPrismaClient,
  StudioService,
  createLogger,
  AuditService,
} from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:claw-studio:accounts:reset-password');

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ studioRecordId: string }> },
) {
  let userId: string | undefined;
  try {
    const tenantId = await getSessionTenantId(authOptions);
    userId = await getSessionUserId(authOptions);
    const { studioRecordId } = await params;

    const service = new StudioService(tenantId, getPrismaClient());
    const result = await service.resetPasswordForUser(studioRecordId, userId);

    logger.info({ userId, studioId: result.studioId }, 'Reset a Claw Studio account password');
    await AuditService.logResourceAction({
      action: 'update',
      resourceType: 'ClawStudio',
      resourceId: result.studioRecordId,
      resourceName: result.studioId,
      status: 'success',
      user: userId,
      userType: 'user',
      tenantId,
      source: 'platform',
      details: 'Reset Claw Studio password',
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return Response.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    // 404 for both "no such studio" and "not yours" — telling the two apart
    // would confirm that a studio id exists.
    if (error instanceof Error && error.message === 'Studio not found') {
      return Response.json({ error: 'Studio not found' }, { status: 404 });
    }
    logger.error({ error, userId }, 'Failed to reset a Claw Studio account password');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextRequest } from 'next/server';
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  getPrismaClient,
  StudioService,
  resetStudioPasswordSchema,
  createLogger,
  AuditService,
} from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:claw-studio:reset-password');

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('update', 'ClawStudio', authOptions);
    if (authError) return authError;

    const body = await req.json().catch(() => ({}));
    const parsed = resetStudioPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }),
        { status: 400 },
      );
    }

    const db = getPrismaClient();
    const service = new StudioService(tenantId, db);
    const result = await service.resetPassword();

    logger.info({ tenantId }, 'Claw Studio password reset');
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
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    if (error instanceof Error && error.message.includes('No Studio')) {
      return new Response(JSON.stringify({ error: error.message }), { status: 404 });
    }
    logger.error({ error }, 'Failed to reset Claw Studio password');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}

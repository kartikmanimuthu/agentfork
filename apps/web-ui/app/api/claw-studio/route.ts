import { NextRequest } from 'next/server';
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  getPrismaClient,
  StudioService,
  provisionStudioSchema,
  createLogger,
  AuditService,
} from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:claw-studio');

export async function GET() {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'ClawStudio', authOptions);
    if (authError) return authError;

    const db = getPrismaClient();
    const service = new StudioService(tenantId, db);
    const studio = await service.getForTenant();

    return new Response(JSON.stringify({ studio }), { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    logger.error({ error }, 'Failed to fetch Claw Studio');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'ClawStudio', authOptions);
    if (authError) return authError;

    const body = await req.json().catch(() => ({}));
    const parsed = provisionStudioSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }),
        { status: 400 },
      );
    }

    const db = getPrismaClient();
    const service = new StudioService(tenantId, db);
    const result = await service.provision();

    logger.info(
      { tenantId, studioId: result.studioId, clawId: result.clawId },
      'Claw Studio provisioned',
    );
    await AuditService.logResourceAction({
      action: 'create',
      resourceType: 'ClawStudio',
      resourceId: result.studioRecordId,
      resourceName: result.studioId,
      status: 'success',
      user: userId,
      userType: 'user',
      tenantId,
      source: 'platform',
      details: 'Provisioned Claw Studio',
    });
    return new Response(JSON.stringify(result), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    if (error instanceof Error && error.message.includes('already exists')) {
      return new Response(JSON.stringify({ error: error.message }), { status: 409 });
    }
    logger.error({ error }, 'Failed to provision Claw Studio');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}

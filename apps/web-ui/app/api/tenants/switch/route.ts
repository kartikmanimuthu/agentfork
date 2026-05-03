import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getPrismaClient, AuditService, tenantSwitchSchema, parseJson, ValidationError } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api-tenants-switch');

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const { tenantId } = await parseJson(req, tenantSwitchSchema);

    const prisma = getPrismaClient();

    // Verify user actually belongs to this tenant
    const utr = await prisma.userTenantRole.findFirst({
      where: { userId: session.user.id, tenantId },
    });
    if (!utr) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Persist the active tenant choice
    await prisma.authUser.update({
      where: { id: session.user.id },
      data: { activeTenantId: tenantId },
    });

    logger.info({ userId: session.user.id, tenantId }, 'API - POST /api/tenants/switch - Switched tenant');

    // Fire-and-forget audit log
    AuditService.logUserAction({
      eventType: 'tenant.organization.switched',
      severity: 'low',
      apiRoute: 'POST /api/tenants/switch',
      httpMethod: 'POST',
      action: 'Switched Organization',
      resourceType: 'tenant',
      resourceId: tenantId,
      resourceName: tenantId,
      user: session.user.email || session.user.id,
      userType: 'user',
      status: 'success',
      details: `Switched active organization to ${tenantId}`,
      metadata: { tenantId },
      tenantId,
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    logger.error({ error }, 'API - POST /api/tenants/switch - Error');
    return NextResponse.json(
      { error: 'Failed to switch organization' },
      { status: 500 },
    );
  }
}

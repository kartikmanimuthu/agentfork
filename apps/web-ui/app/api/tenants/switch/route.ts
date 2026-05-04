import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getPrismaClient, AuditService, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:tenants:switch');

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const { tenantId } = await req.json();
    if (!tenantId || typeof tenantId !== 'string') {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

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

    logger.info({ userId: session.user.id, tenantId }, 'Switched tenant');

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
    logger.error({ error }, 'Error switching tenant');
    return NextResponse.json(
      { error: 'Failed to switch organization' },
      { status: 500 },
    );
  }
}

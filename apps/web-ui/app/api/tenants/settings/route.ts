import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getPrismaClient, getSessionTenantId, authorize, TenantConfigService, AuditService, updateTenantSettingsSchema, parseJson, ValidationError } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Settings', authOptions);
    if (authError) return authError;

    const prisma = getPrismaClient();
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const configService = new TenantConfigService(tenantId);
    const [timezone, notifications] = await Promise.all([
      configService.get<string>('timezone'),
      configService.get<Record<string, boolean>>('notifications'),
    ]);

    return NextResponse.json({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      timezone: timezone ?? 'UTC',
      notifications: {
        scheduleExecutions: true,
        memberInvites: true,
        systemAlerts: true,
        ...notifications,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Settings', authOptions);
    if (authError) return authError;

    const { name, timezone, notifications } = await parseJson(req, updateTenantSettingsSchema);

    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ?? 'system';

    const prisma = getPrismaClient();

    const currentTenant = name ? await prisma.tenant.findUnique({ where: { id: tenantId } }) : null;
    const currentName = currentTenant?.name;

    if (name) {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { name },
      });
    }

    const configService = new TenantConfigService(tenantId);
    if (timezone !== undefined) {
      await configService.set('timezone', timezone, userId);
    }
    if (notifications !== undefined) {
      await configService.set('notifications', notifications, userId);
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const [savedTimezone, savedNotifications] = await Promise.all([
      configService.get<string>('timezone'),
      configService.get<Record<string, boolean>>('notifications'),
    ]);

    AuditService.logUserAction({
      eventType: 'tenant.organization.updated',
      action: 'Updated Organization Settings',
      resourceType: 'tenant',
      resourceId: tenantId,
      resourceName: name || tenant?.name || tenantId,
      user: session?.user?.email || session?.user?.id || 'unknown',
      userType: 'user',
      status: 'success',
      severity: 'medium',
      details: `Updated organization settings for ${tenantId}`,
      apiRoute: 'PUT /api/tenants/settings',
      httpMethod: 'PUT',
      metadata: { tenantId, name, timezone, notifications },
      tenantId,
      changeSet: { before: { name: currentName }, after: { name: tenant?.name } },
    }).catch(() => {});

    return NextResponse.json({
      id: tenant?.id,
      name: tenant?.name,
      slug: tenant?.slug,
      status: tenant?.status,
      timezone: savedTimezone ?? 'UTC',
      notifications: {
        scheduleExecutions: true,
        memberInvites: true,
        systemAlerts: true,
        ...savedNotifications,
      },
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
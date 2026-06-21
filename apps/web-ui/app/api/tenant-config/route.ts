import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getSessionTenantId, authorize, TenantConfigService, AuditService, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('api:tenant-config');

const putSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Settings', authOptions);
    if (authError) return authError;

    const key = req.nextUrl.searchParams.get('key');
    if (!key) {
      return NextResponse.json({ error: 'Missing required query param: key' }, { status: 400 });
    }

    const configService = new TenantConfigService(tenantId);
    const value = await configService.get(key);

    logger.info({ tenantId, key }, 'Fetched tenant config');

    return NextResponse.json({ key, value: value ?? null });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to fetch tenant config');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Settings', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const { key, value } = parsed.data;
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ?? 'system';

    const configService = new TenantConfigService(tenantId);
    await configService.set(key, value, userId);

    logger.info({ tenantId, key }, 'Updated tenant config');

    AuditService.logUserAction({
      eventType: 'tenant.config.updated',
      action: 'Updated Tenant Config',
      resourceType: 'tenant',
      resourceId: tenantId,
      resourceName: key,
      user: session?.user?.email ?? session?.user?.id ?? 'unknown',
      userType: 'user',
      status: 'success',
      severity: 'medium',
      details: `Updated tenant config key: ${key}`,
      apiRoute: 'PUT /api/tenant-config',
      httpMethod: 'PUT',
      metadata: { tenantId, key },
      tenantId,
    }).catch(() => {});

    return NextResponse.json({ key, value });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to update tenant config');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

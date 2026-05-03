import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getPrismaClient, AuditService, createTenantSchema, parseJson, ValidationError } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api-tenants');

export async function POST(req: NextRequest) {
  let session: any = null;
  try {
    session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const { name, slug } = await parseJson(req, createTenantSchema);
    const prisma = getPrismaClient();

    const result = await prisma.$transaction(async (tx) => {
      const existingSlug = await tx.tenant.findUnique({ where: { slug } });
      if (existingSlug) {
        throw new Error('SLUG_TAKEN');
      }

      const tenant = await tx.tenant.create({
        data: {
          name,
          slug,
          status: 'active',
        },
      });

      await tx.userTenantRole.create({
        data: {
          userId: session.user.id,
          tenantId: tenant.id,
          email: session.user.email,
          role: 'Owner',
          roleId: null,
          assignedBy: session.user.id,
        },
      });

      return tenant;
    });

    await prisma.authUser.update({
      where: { id: session.user.id },
      data: { activeTenantId: result.id },
    });

    AuditService.logUserAction({
      eventType: 'tenant.organization.created',
      action: 'Created Organization',
      resourceType: 'tenant',
      resourceId: result.id,
      resourceName: name,
      user: session.user.email || session.user.id,
      userType: 'user',
      status: 'success',
      severity: 'high',
      details: `Created organization "${name}" (slug: ${slug})`,
      apiRoute: 'POST /api/tenants',
      httpMethod: 'POST',
      metadata: { tenantId: result.id, name, slug },
      tenantId: result.id,
    }).catch(() => {});

    logger.info({ tenantId: result.id, slug: result.slug }, 'API - POST /api/tenants - Created tenant');

    return NextResponse.json(
      { success: true, tenantId: result.id, slug: result.slug },
      { status: 201 },
    );
  } catch (error: unknown) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.message === 'SLUG_TAKEN') {
      return NextResponse.json(
        { error: 'This slug is already taken. Try another.' },
        { status: 409 },
      );
    }
    logger.error({ error }, 'API - POST /api/tenants - Error');
    return NextResponse.json(
      { error: 'Failed to create organization. Please try again.' },
      { status: 500 },
    );
  }
}

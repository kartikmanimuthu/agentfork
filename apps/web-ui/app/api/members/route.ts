import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, getSessionTenantId, authorize, AuditService, getAuthSession, updateMemberSchema, memberIdQuerySchema, parseJson, parseSearchParams, ValidationError } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

// GET /api/members - List tenant members
export async function GET(req: NextRequest) {
  const tenantId = await getSessionTenantId(authOptions);
  if (!tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authError = await authorize('read', 'Users', authOptions);
  if (authError) return authError;

  const prisma = getPrismaClient();
  const members = await prisma.userTenantRole.findMany({
    where: { tenantId },
    include: { user: { select: { id: true, email: true } } },
    orderBy: { assignedAt: 'desc' },
  });

  return NextResponse.json(members);
}

// PUT /api/members - Update member role
export async function PUT(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const authError = await authorize('update', 'Users', authOptions);
    if (authError) return authError;

    const { userId, role } = await parseJson(req, updateMemberSchema);

    const prisma = getPrismaClient();

  // Prevent self-role changes (optional safety)
  // const session = await getAuthSession();
  // if (session?.user?.id === userId) {
  //   return NextResponse.json({ error: 'Cannot change your own role' }, { status: 403 });
  // }

  const existingRole = await prisma.userTenantRole.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
  });

  const updated = await prisma.userTenantRole.update({
    where: { userId_tenantId: { userId, tenantId } },
    data: { role },
  });

  const session = await getAuthSession();
  AuditService.logUserAction({
    eventType: 'rbac.member.role_updated',
    action: 'Updated Member Role',
    resourceType: 'member',
    resourceId: userId,
    resourceName: userId,
    user: session?.user?.email || session?.user?.id || 'unknown',
    userType: 'user',
    status: 'success',
    severity: 'medium',
    details: `Updated member ${userId} role to ${role}`,
    apiRoute: 'PUT /api/members',
    httpMethod: 'PUT',
    changeSet: { before: { role: existingRole?.role }, after: { role } },
    metadata: { tenantId, userId, role },
    tenantId,
  }).catch(() => {});

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

// DELETE /api/members - Remove member from tenant
export async function DELETE(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const authError = await authorize('delete', 'Users', authOptions);
    if (authError) return authError;

    const { userId } = parseSearchParams(new URL(req.url).searchParams, memberIdQuerySchema);

    const prisma = getPrismaClient();
  await prisma.userTenantRole.delete({
    where: { userId_tenantId: { userId, tenantId } },
  });

  const session = await getAuthSession();
  AuditService.logUserAction({
    eventType: 'rbac.member.removed',
    action: 'Removed Member',
    resourceType: 'member',
    resourceId: userId,
    resourceName: userId,
    user: session?.user?.email || session?.user?.id || 'unknown',
    userType: 'user',
    status: 'success',
    severity: 'high',
    details: `Removed member ${userId} from organization`,
    apiRoute: 'DELETE /api/members',
    httpMethod: 'DELETE',
    metadata: { tenantId, userId },
    tenantId,
  }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

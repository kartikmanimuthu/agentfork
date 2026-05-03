import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  getCustomRoles,
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
  ROLE_PERMISSIONS,
  ROLE_LEVELS,
  AuditService,
  getAuthSession,
} from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

// GET /api/roles - List predefined + custom roles
export async function GET(req: NextRequest) {
  const tenantId = await getSessionTenantId(authOptions);
  if (!tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authError = await authorize('read', 'Users', authOptions);
  if (authError) return authError;

  const custom = await getCustomRoles(tenantId);

  const predefined = Object.entries(ROLE_PERMISSIONS).map(([name, permissions]) => ({
    id: name.toLowerCase(),
    name,
    permissions,
    level: ROLE_LEVELS[name as keyof typeof ROLE_LEVELS],
    predefined: true,
  }));

  return NextResponse.json({ predefined, custom });
}

// POST /api/roles - Create custom role
export async function POST(req: NextRequest) {
  const tenantId = await getSessionTenantId(authOptions);
  if (!tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authError = await authorize('create', 'Users', authOptions);
  if (authError) return authError;

  const body = await req.json();
  const { name, permissions } = body;

  if (!name || !permissions) {
    return NextResponse.json({ error: 'Missing name or permissions' }, { status: 400 });
  }

  try {
    const role = await createCustomRole(tenantId, { name, permissions });
    const session = await getAuthSession();
    AuditService.logUserAction({
      eventType: 'rbac.role.created',
      action: 'Created Role',
      resourceType: 'role',
      resourceId: role.id,
      resourceName: role.name,
      user: session?.user?.email || session?.user?.id || 'unknown',
      userType: 'user',
      status: 'success',
      severity: 'medium',
      details: `Created custom role "${role.name}"`,
      apiRoute: 'POST /api/roles',
      httpMethod: 'POST',
      metadata: { tenantId, roleId: role.id, name: role.name, permissions: role.permissions },
      tenantId,
    }).catch(() => {});
    return NextResponse.json(role, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// PUT /api/roles - Update custom role
export async function PUT(req: NextRequest) {
  const tenantId = await getSessionTenantId(authOptions);
  if (!tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authError = await authorize('update', 'Users', authOptions);
  if (authError) return authError;

  const body = await req.json();
  const { id, name, permissions } = body;

  if (!id || !name || !permissions) {
    return NextResponse.json({ error: 'Missing id, name, or permissions' }, { status: 400 });
  }

  try {
    const role = await updateCustomRole(tenantId, id, { name, permissions });
    const session = await getAuthSession();
    AuditService.logUserAction({
      eventType: 'rbac.role.updated',
      action: 'Updated Role',
      resourceType: 'role',
      resourceId: role.id,
      resourceName: role.name,
      user: session?.user?.email || session?.user?.id || 'unknown',
      userType: 'user',
      status: 'success',
      severity: 'medium',
      details: `Updated custom role "${role.name}"`,
      apiRoute: 'PUT /api/roles',
      httpMethod: 'PUT',
      metadata: { tenantId, roleId: role.id, name: role.name, permissions: role.permissions },
      tenantId,
    }).catch(() => {});
    return NextResponse.json(role);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// DELETE /api/roles - Delete custom role
export async function DELETE(req: NextRequest) {
  const tenantId = await getSessionTenantId(authOptions);
  if (!tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authError = await authorize('delete', 'Users', authOptions);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  try {
    await deleteCustomRole(tenantId, id);
    const session = await getAuthSession();
    AuditService.logUserAction({
      eventType: 'rbac.role.deleted',
      action: 'Deleted Role',
      resourceType: 'role',
      resourceId: id,
      resourceName: id,
      user: session?.user?.email || session?.user?.id || 'unknown',
      userType: 'user',
      status: 'success',
      severity: 'high',
      details: `Deleted custom role ${id}`,
      apiRoute: 'DELETE /api/roles',
      httpMethod: 'DELETE',
      metadata: { tenantId, roleId: id },
      tenantId,
    }).catch(() => {});
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

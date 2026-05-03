import { NextRequest, NextResponse } from 'next/server';
import { authorize, getSessionTenantId, getAuthSession, AuditService, InvitationService, createInvitationSchema, invitationIdQuerySchema, parseJson, parseSearchParams, ValidationError } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api-invitations');

export async function POST(request: NextRequest) {
  logger.info('API - POST /api/invitations - Creating invitation');
  const authError = await authorize('create', 'Users', authOptions);
  if (authError) return authError;

  try {
    const tenantId = await getSessionTenantId(authOptions);
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const invitedBy = session.user.id;
    const { email, role } = await parseJson(request, createInvitationSchema);

    const result = await InvitationService.createInvitation(tenantId, email, role, invitedBy);

    AuditService.logUserAction({
      eventType: 'rbac.member.invited',
      action: 'Invited Member',
      resourceType: 'invitation',
      resourceId: result.invitation.id,
      resourceName: result.invitation.email,
      user: session.user.email || session.user.id,
      userType: 'user',
      status: 'success',
      severity: 'medium',
      details: `Invited ${result.invitation.email} as ${result.invitation.role}`,
      apiRoute: 'POST /api/invitations',
      httpMethod: 'POST',
      metadata: { tenantId, invitationId: result.invitation.id, email: result.invitation.email, role: result.invitation.role },
      tenantId,
    }).catch(() => {});

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    logger.error({ error }, 'API - Error creating invitation');
    const message = error instanceof Error ? error.message : 'Failed to create invitation';
    const isConflict = message.includes('already');
    return NextResponse.json(
      { success: false, error: message },
      { status: isConflict ? 409 : 500 },
    );
  }
}

export async function GET() {
  logger.info('API - GET /api/invitations - Listing invitations');
  const authError = await authorize('read', 'Users', authOptions);
  if (authError) return authError;

  try {
    const tenantId = await getSessionTenantId(authOptions);
    const invitations = await InvitationService.listInvitations(tenantId);
    return NextResponse.json({ success: true, data: invitations });
  } catch (error) {
    logger.error({ error }, 'API - Error listing invitations');
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list invitations',
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  logger.info('API - DELETE /api/invitations - Revoking invitation');
  const authError = await authorize('delete', 'Users', authOptions);
  if (authError) return authError;

  try {
    const tenantId = await getSessionTenantId(authOptions);
    const { id } = parseSearchParams(new URL(request.url).searchParams, invitationIdQuerySchema);

    const result = await InvitationService.revokeInvitation(id, tenantId);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    logger.error({ error }, 'API - Error revoking invitation');
    const message = error instanceof Error ? error.message : 'Failed to revoke invitation';
    return NextResponse.json(
      { success: false, error: message },
      { status: message.includes('not found') ? 404 : 500 },
    );
  }
}

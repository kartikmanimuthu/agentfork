import { NextRequest, NextResponse } from 'next/server';
import { authorize, getSessionTenantId, getAuthSession, AuditService } from '@chatbot/shared';
import { InvitationService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function POST(request: NextRequest) {
  console.log('API - POST /api/invitations - Creating invitation');
  const authError = await authorize('create', 'Users', authOptions);
  if (authError) return authError;

  try {
    const tenantId = await getSessionTenantId(authOptions);
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const invitedBy = session.user.id;
    const { email, role } = await request.json();

    if (!email || !role) {
      return NextResponse.json(
        { success: false, error: 'Email and role are required' },
        { status: 400 },
      );
    }

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
    console.error('API - Error creating invitation:', error);
    const message = error instanceof Error ? error.message : 'Failed to create invitation';
    const isConflict = message.includes('already');
    return NextResponse.json(
      { success: false, error: message },
      { status: isConflict ? 409 : 500 },
    );
  }
}

export async function GET() {
  console.log('API - GET /api/invitations - Listing invitations');
  const authError = await authorize('read', 'Users', authOptions);
  if (authError) return authError;

  try {
    const tenantId = await getSessionTenantId(authOptions);
    const invitations = await InvitationService.listInvitations(tenantId);
    return NextResponse.json({ success: true, data: invitations });
  } catch (error) {
    console.error('API - Error listing invitations:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list invitations',
      },
      { status: 500 },
    );
  }
}

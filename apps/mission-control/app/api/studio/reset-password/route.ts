import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { StudioService, getPrismaClient, createLogger, AuditService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:studio:reset-password');

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    const { tenantId, studioId: actor } = session.studio;

    const result = await new StudioService(tenantId, getPrismaClient()).resetPassword();

    AuditService.logUserAction({
      eventType: 'claw.studio.password_reset',
      action: 'Reset Studio Password',
      resourceType: 'studio',
      resourceId: result.studioRecordId,
      resourceName: result.studioId,
      user: actor,
      userType: 'user',
      status: 'success',
      severity: 'high',
      details: 'Studio password was reset — a new password was generated',
      apiRoute: 'POST /api/studio/reset-password',
      httpMethod: 'POST',
      metadata: { tenantId },
      tenantId,
    }).catch(() => {});

    // The generated password is only ever returned here, once — never stored
    // or logged in plaintext anywhere after this response.
    return NextResponse.json({ success: true, data: { password: result.password } });
  } catch (error) {
    logger.error({ error }, 'Failed to reset studio password');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

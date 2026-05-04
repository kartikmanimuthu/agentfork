import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, getSessionUserId, AuditService, parseJson, ValidationError } from '@chatbot/shared';
import { changePasswordSchema } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import bcrypt from 'bcryptjs';

export async function PUT(req: NextRequest) {
  try {
    const userId = await getSessionUserId(authOptions);

    let body;
    try {
      body = await parseJson(req, changePasswordSchema);
    } catch (error) {
      if (error instanceof ValidationError) {
        return NextResponse.json({ error: error.issues[0]?.message }, { status: 400 });
      }
      throw error;
    }

    const { currentPassword, newPassword } = body;

    const prisma = getPrismaClient();
    const user = await prisma.authUser.findUnique({
      where: { id: userId },
      select: { passwordHash: true, email: true, activeTenantId: true },
    });

    if (!user || !user.passwordHash) {
      return NextResponse.json({ error: 'SSO accounts cannot change password here' }, { status: 403 });
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await prisma.authUser.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    if (user.activeTenantId) {
      AuditService.logUserAction({
        eventType: 'auth.password.changed',
        action: 'Changed Password',
        resourceType: 'user',
        resourceId: userId,
        resourceName: user.email || userId,
        user: user.email || userId,
        userType: 'user',
        status: 'success',
        severity: 'medium',
        details: `User changed their password`,
        apiRoute: 'PUT /api/user/password',
        httpMethod: 'PUT',
        metadata: { userId },
        tenantId: user.activeTenantId,
      }).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

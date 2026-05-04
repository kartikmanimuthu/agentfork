import { NextRequest, NextResponse } from 'next/server';
import {
  getPrismaClient,
  AuditService,
  parseJson,
  ValidationError,
  resetPasswordSchema,
} from '@chatbot/shared';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  try {
    let body;
    try {
      body = await parseJson(req, resetPasswordSchema);
    } catch (error) {
      if (error instanceof ValidationError) {
        return NextResponse.json(
          { error: error.issues[0]?.message },
          { status: 400 },
        );
      }
      throw error;
    }

    const { token, password } = body;
    const prisma = getPrismaClient();

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!resetToken || resetToken.expires < new Date()) {
      return NextResponse.json(
        { error: 'Invalid or expired reset token' },
        { status: 400 },
      );
    }

    const user = await prisma.authUser.findUnique({
      where: { email: resetToken.email },
      select: { id: true, email: true, passwordHash: true },
    });

    if (!user || !user.passwordHash) {
      return NextResponse.json(
        { error: 'Invalid or expired reset token' },
        { status: 400 },
      );
    }

    const newHash = await bcrypt.hash(password, 12);
    await prisma.authUser.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    // Clean up all reset tokens for this email
    await prisma.passwordResetToken.deleteMany({
      where: { email: resetToken.email },
    });

    AuditService.logUserAction({
      eventType: 'auth.password.reset_completed',
      action: 'Completed Password Reset',
      resourceType: 'user',
      resourceId: user.id,
      resourceName: user.email || user.id,
      user: user.email || user.id,
      userType: 'user',
      status: 'success',
      severity: 'medium',
      details: `Password reset completed for ${resetToken.email}`,
      apiRoute: 'POST /api/auth/reset-password',
      httpMethod: 'POST',
      metadata: { userId: user.id, email: resetToken.email },
      tenantId: undefined,
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

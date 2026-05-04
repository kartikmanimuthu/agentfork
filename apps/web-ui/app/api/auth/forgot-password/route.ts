import { NextRequest, NextResponse } from 'next/server';
import {
  getPrismaClient,
  AuditService,
  parseJson,
  ValidationError,
  getEmailService,
  forgotPasswordSchema,
} from '@chatbot/shared';
import { env } from '@chatbot/shared';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    let body;
    try {
      body = await parseJson(req, forgotPasswordSchema);
    } catch (error) {
      if (error instanceof ValidationError) {
        return NextResponse.json(
          { error: error.issues[0]?.message },
          { status: 400 },
        );
      }
      throw error;
    }

    const { email } = body;
    const prisma = getPrismaClient();

    // Only allow password reset for local credential users (those with a passwordHash)
    const user = await prisma.authUser.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });

    // Always return success to prevent email enumeration
    if (!user || !user.passwordHash) {
      return NextResponse.json(
        { message: 'If an account exists, a reset link has been sent' },
        { status: 200 },
      );
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordResetToken.create({
      data: {
        email,
        token,
        expires,
      },
    });

    const appUrl = env.APP_URL ?? 'http://localhost:3001';
    const resetUrl = `${appUrl}/reset-password?token=${token}`;

    const emailService = getEmailService();
    await emailService.sendEmail({
      to: email,
      subject: 'Reset your password',
      text: `You requested a password reset. Click the link below to reset your password:\n\n${resetUrl}\n\nThis link will expire in 1 hour. If you did not request this, please ignore this email.`,
      html: `<p>You requested a password reset. Click the link below to reset your password:</p>
<p><a href="${resetUrl}">Reset your password</a></p>
<p>This link will expire in 1 hour. If you did not request this, please ignore this email.</p>`,
    });

    AuditService.logUserAction({
      eventType: 'auth.password.reset_requested',
      action: 'Requested Password Reset',
      resourceType: 'user',
      resourceId: user.id,
      resourceName: user.email || user.id,
      user: user.email || user.id,
      userType: 'user',
      status: 'success',
      severity: 'medium',
      details: `Password reset requested for ${email}`,
      apiRoute: 'POST /api/auth/forgot-password',
      httpMethod: 'POST',
      metadata: { userId: user.id, email },
      tenantId: undefined,
    }).catch(() => {});

    return NextResponse.json(
      { message: 'If an account exists, a reset link has been sent' },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { message: 'If an account exists, a reset link has been sent' },
      { status: 200 },
    );
  }
}

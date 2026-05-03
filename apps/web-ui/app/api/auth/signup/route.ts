import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, AuditService, signupSchema, parseJson, ValidationError } from '@chatbot/shared';
import bcrypt from 'bcryptjs';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api-auth-signup');

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await parseJson(req, signupSchema);

    const prisma = getPrismaClient();

    const existing = await prisma.authUser.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Sign in instead.' },
        { status: 409 },
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.authUser.create({
      data: {
        email,
        passwordHash,
        isSuperAdmin: false,
      },
    });

    AuditService.logUserAction({
      eventType: 'auth.signup.created',
      action: 'User Registered',
      resourceType: 'user',
      resourceId: user.id,
      resourceName: email,
      user: email,
      userType: 'user',
      status: 'success',
      severity: 'medium',
      details: `New user registered: ${email}`,
      apiRoute: 'POST /api/auth/signup',
      httpMethod: 'POST',
      metadata: { email, userId: user.id },
    }).catch(() => {});

    logger.info({ userId: user.id }, 'API - POST /api/auth/signup - Created user');

    return NextResponse.json(
      { success: true, userId: user.id },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    logger.error({ error }, 'API - POST /api/auth/signup - Error');
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}

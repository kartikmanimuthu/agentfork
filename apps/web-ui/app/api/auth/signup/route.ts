import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, AuditService } from '@chatbot/shared';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const signupSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const { email, password } = parsed.data;
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

    console.log(`API - POST /api/auth/signup - Created user ${user.id}`);

    return NextResponse.json(
      { success: true, userId: user.id },
      { status: 201 },
    );
  } catch (error) {
    console.error('API - POST /api/auth/signup - Error:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}

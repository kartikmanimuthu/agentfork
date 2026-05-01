import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const { name, slug } = await req.json();
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const prisma = getPrismaClient();
    const tenant = await prisma.tenant.create({
      data: { name, slug: slug ?? name.toLowerCase().replace(/\s+/g, '-') },
    });

    await prisma.userTenantRole.create({
      data: {
        userId: session.user.id,
        tenantId: tenant.id,
        email: session.user.email!,
        role: 'Owner',
        assignedBy: session.user.id,
      },
    });

    await prisma.authUser.update({
      where: { id: session.user.id },
      data: { activeTenantId: tenant.id },
    });

    return NextResponse.json(tenant, { status: 201 });
  } catch (error) {
    console.error('Create tenant error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

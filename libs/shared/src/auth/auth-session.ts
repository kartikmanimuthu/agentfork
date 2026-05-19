import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { getAuthOptions } from './auth-options';
import { getPrismaClient } from '../db/prisma-client';

export async function getAuthSession() {
  return getServerSession(getAuthOptions());
}

export async function getSessionTenantId(authOptions: any): Promise<string> {
  const session: any = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error('Unauthenticated: no valid session');
  }
  if (!session.user.tenantId) {
    throw new Error('Unauthorized: no tenant associated with session');
  }

  // Guard against stale JWTs: the tenant may have been deleted since the
  // session was issued. A missing tenant will otherwise cause cryptic FK
  // violations on INSERTs.
  const prisma = getPrismaClient();
  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
  });
  if (!tenant) {
    throw new Error(
      'Unauthorized: tenant no longer exists. Please log out and log back in.',
    );
  }

  return session.user.tenantId;
}

export async function getSessionUserId(authOptions: any): Promise<string> {
  const session: any = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('Unauthenticated: no valid session');
  }
  return session.user.id;
}

export async function assertSuperAdmin(authOptions: any): Promise<NextResponse | null> {
  const session: any = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Unauthenticated', message: 'No valid session' },
      { status: 401 },
    );
  }
  if (session.user.isSuperAdmin !== true) {
    return NextResponse.json(
      { error: 'Forbidden', message: 'Super admin access required' },
      { status: 403 },
    );
  }
  return null;
}

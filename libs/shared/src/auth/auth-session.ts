import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

export async function getSessionTenantId(authOptions: any): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error('Unauthenticated: no valid session');
  }
  if (!session.user.tenantId) {
    throw new Error('Unauthorized: no tenant associated with session');
  }
  return session.user.tenantId;
}

export async function getSessionUserId(authOptions: any): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('Unauthenticated: no valid session');
  }
  return session.user.id;
}

export async function assertSuperAdmin(authOptions: any): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
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

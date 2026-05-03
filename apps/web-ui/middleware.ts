import { withAuth, NextRequestWithAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req: NextRequestWithAuth) {
    const token = req.nextauth.token;
    const { pathname } = req.nextUrl;

    if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
      if (token?.isSuperAdmin !== true) {
        return NextResponse.json(
          { error: 'Forbidden', message: 'Super admin access required' },
          { status: 403 },
        );
      }
    }

    const skipNoTenantRedirect =
      pathname === '/create-org' ||
      pathname.startsWith('/api/') ||
      pathname === '/login' ||
      pathname === '/register' ||
      pathname === '/signup' ||
      pathname === '/' ||
      pathname.startsWith('/docs');

    if (!skipNoTenantRedirect && token && !token.tenantId) {
      return NextResponse.redirect(new URL('/create-org', req.url));
    }

    const requestHeaders = new Headers(req.headers);
    if (token?.tenantId) {
      requestHeaders.set('x-tenant-id', token.tenantId as string);
    }

    return NextResponse.next({ request: { headers: requestHeaders } });
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const { pathname } = req.nextUrl;
        if (
          pathname === '/login' ||
          pathname === '/register' ||
          pathname === '/signup' ||
          pathname === '/' ||
          pathname.startsWith('/docs')
        ) {
          return true;
        }
        return !!token;
      },
    },
  },
);

export const config = {
  matcher: [
    '/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|login|register|signup|docs).*)',
  ],
};

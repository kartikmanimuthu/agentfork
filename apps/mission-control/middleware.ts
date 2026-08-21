import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { SESSION_COOKIE_NAME } from '@/lib/auth-cookies';

// Mission Control authenticates with its own Studio ID + password (NextAuth
// Credentials provider, see lib/auth.ts) — it does not trust web-ui's session.
// If there's a valid token, let the request through and forward the tenant id
// as a header. If not, send the visitor to Mission Control's own login page.
export async function middleware(req: NextRequest) {
  const token = await getToken({ req, cookieName: SESSION_COOKIE_NAME });

  if (!token) {
    // Clone nextUrl rather than `new URL('/login', req.url)` — NextURL re-applies
    // basePath on stringify, so the plain-URL form would drop the prefix and redirect
    // to web-ui's root instead of Mission Control's login page.
    const loginUrl = req.nextUrl.clone();
    const target = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    // Relative, not req.nextUrl.href — behind the ALB the absolute form resolves to the
    // container's own bind address (0.0.0.0:3010), which NextAuth rejects as an
    // off-origin callback. A leading-slash path is resolved against NEXTAUTH_URL, which
    // already carries the basePath.
    loginUrl.searchParams.set('callbackUrl', target);
    return NextResponse.redirect(loginUrl);
  }

  const requestHeaders = new Headers(req.headers);
  if (token.tenantId) {
    requestHeaders.set('x-tenant-id', token.tenantId as string);
  }
  return NextResponse.next({ request: { headers: requestHeaders } });
}

// Guard pages only; API routes self-guard via getServerSession (returning 401),
// so excluding /api avoids redirecting fetch() calls to an HTML login page.
// /login is also excluded so the login page itself isn't caught in the redirect loop.
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|login).*)'],
};

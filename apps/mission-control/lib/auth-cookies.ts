import { env } from '@/lib/env';

// Mission Control is served from the same origin as web-ui (under BASE_PATH), and both
// run NextAuth. NextAuth's default cookie name is `next-auth.session-token` for both, so
// without distinct names the two apps overwrite each other's session on every login —
// and because they sign with different secrets, neither can decode the other's token,
// producing a login loop. Namespacing the three NextAuth cookies keeps the sessions
// independent. Path stays "/" so the __Host- prefix rules for the CSRF cookie still hold.
const useSecureCookies = env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const securePrefix = useSecureCookies ? '__Secure-' : '';
const hostPrefix = useSecureCookies ? '__Host-' : '';

export const SESSION_COOKIE_NAME = `${securePrefix}mission-control.session-token`;

export const authCookies = {
  sessionToken: {
    name: SESSION_COOKIE_NAME,
    options: { httpOnly: true, sameSite: 'lax', path: '/', secure: useSecureCookies },
  },
  callbackUrl: {
    name: `${securePrefix}mission-control.callback-url`,
    options: { httpOnly: true, sameSite: 'lax', path: '/', secure: useSecureCookies },
  },
  csrfToken: {
    name: `${hostPrefix}mission-control.csrf-token`,
    options: { httpOnly: true, sameSite: 'lax', path: '/', secure: useSecureCookies },
  },
} as const;

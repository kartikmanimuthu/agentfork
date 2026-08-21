import type { NextAuthOptions, User } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getPrismaClient, StudioService, createLogger } from '@chatbot/shared';
import { env } from '@/lib/env';
import { authCookies } from '@/lib/auth-cookies';
import { BASE_PATH } from '@/lib/base-path';

const logger = createLogger('mission-control:auth');

export const authOptions: NextAuthOptions = {
  secret: env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 24 * 60 * 60 },
  cookies: authCookies,
  // Prefixed explicitly: NextAuth resolves `pages` against the origin only, ignoring
  // Next's basePath, so a bare '/login' sends the browser to web-ui's root.
  pages: { signIn: `${BASE_PATH}/login`, error: `${BASE_PATH}/login` },
  providers: [
    CredentialsProvider({
      id: 'studio',
      name: 'Studio',
      credentials: {
        studioId: { label: 'Studio ID', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.studioId || !credentials?.password) return null;
          const service = new StudioService('', getPrismaClient());
          const result = await service.authenticate(
            credentials.studioId as string,
            credentials.password as string,
          );
          if (!result) return null;
          // NextAuth requires an `id` on the returned user object. Cast is needed because
          // @chatbot/shared's ambient `next-auth` module augmentation (for web-ui's user auth)
          // shapes `User` for that flow; the Studio flow carries a different set of fields.
          return { id: result.studioRecordId, ...result } as unknown as User;
        } catch (error) {
          logger.error({ error }, 'Studio authorize failed');
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as { studioId: string; tenantId: string; clawId: string; studioRecordId: string };
        token.studioId = u.studioId;
        token.tenantId = u.tenantId;
        token.clawId = u.clawId;
        token.studioRecordId = u.studioRecordId;
      }
      return token;
    },
    async session({ session, token }) {
      session.studio = {
        studioId: (token.studioId as string) ?? '',
        tenantId: (token.tenantId as string) ?? '',
        clawId: (token.clawId as string) ?? '',
        studioRecordId: (token.studioRecordId as string) ?? '',
      };
      return session;
    },
  },
};

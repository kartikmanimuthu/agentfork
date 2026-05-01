import { NextAuthOptions } from 'next-auth';
import CognitoProvider from 'next-auth/providers/cognito';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { getPrismaClient } from '../db/prisma-client';

export function createAuthOptions(overrides?: Partial<NextAuthOptions>): NextAuthOptions {
  const prisma = getPrismaClient();

  const prismaForAuth = {
    user: prisma.authUser,
    account: prisma.authAccount,
    session: prisma.authSession,
    verificationToken: prisma.verificationToken,
  };

  return {
    adapter: PrismaAdapter(prismaForAuth as any),
    session: { strategy: 'jwt', maxAge: 24 * 60 * 60 },
    providers: [
      CredentialsProvider({
        id: 'credentials',
        name: 'Credentials',
        credentials: {
          email: { label: 'Email', type: 'email' },
          password: { label: 'Password', type: 'password' },
        },
        async authorize(credentials) {
          if (!credentials?.email || !credentials?.password) return null;
          const user = await prisma.authUser.findUnique({
            where: { email: credentials.email as string },
          });
          if (!user || !user.passwordHash) return null;

          const bcrypt = await import('bcryptjs');
          const valid = await bcrypt.compare(credentials.password as string, user.passwordHash);
          if (!valid) return null;

          return { id: user.id, email: user.email, isSuperAdmin: user.isSuperAdmin };
        },
      }),
      ...(process.env.COGNITO_APP_CLIENT_ID
        ? [
            CognitoProvider({
              clientId: process.env.COGNITO_APP_CLIENT_ID,
              clientSecret: process.env.COGNITO_APP_CLIENT_SECRET!,
              issuer: process.env.COGNITO_ISSUER!,
              allowDangerousEmailAccountLinking: true,
            }),
          ]
        : []),
    ],
    pages: { signIn: '/login', error: '/login' },
    callbacks: {
      async jwt({ token, user, trigger }) {
        if (user || trigger === 'update') {
          const userId = user?.id ?? (token.sub as string);
          const utr = await prisma.userTenantRole.findFirst({
            where: { userId },
            orderBy: { assignedAt: 'desc' },
          });
          token.tenantId = utr?.tenantId ?? null;
          token.role = utr?.role ?? null;
          if (user) {
            token.isSuperAdmin = (user as any).isSuperAdmin ?? false;
          }
        }
        return token;
      },
      async session({ session, token }) {
        if (session.user) {
          session.user.id = token.sub!;
          session.user.tenantId = token.tenantId as string | undefined;
          session.user.role = token.role as string | undefined;
          session.user.isSuperAdmin = token.isSuperAdmin as boolean | undefined;
        }
        return session;
      },
    },
    ...overrides,
  };
}

import { execSync } from 'node:child_process';
import { env } from '../config/env';

/**
 * Mint a NextAuth session JWT for an E2E "Owner" test user.
 *
 * The signing secret is passed to the subprocess via an env var
 * (`__E2E_SECRET`) rather than interpolated into the command string — this
 * avoids shell injection and sources the secret from the typed `env` object.
 */
export function mintSessionToken(): string {
  const script = `
const { encode } = require('next-auth/jwt');
encode({
  token: {
    name: 'Test User',
    email: 'test@example.com',
    sub: 'test-user-id',
    tenantId: 'test-tenant-id',
    role: 'Owner',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  },
  secret: process.env.__E2E_SECRET,
}).then((t) => process.stdout.write(t));
`;

  return execSync(`node -e "${script}"`, {
    env: { ...process.env, __E2E_SECRET: env.NEXTAUTH_SECRET },
  })
    .toString()
    .trim();
}

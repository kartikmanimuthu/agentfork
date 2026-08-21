import { execSync } from 'node:child_process';

/**
 * Idempotently seed the tenant row that `mintSessionToken` bakes into every
 * session JWT (`tenantId: 'test-tenant-id'`). Without it, `getSessionTenantId`'s
 * existence guard 500s every tenant-scoped API.
 *
 * Runs `@prisma/client` in a subprocess (like `mintSessionToken` does for
 * `next-auth/jwt`) rather than importing it into the Playwright TS runtime,
 * so this suite stays decoupled from `@prisma/client`/`@chatbot/shared`.
 * `DATABASE_URL` is passed through the subprocess env for Prisma to read —
 * never string-interpolated into the script.
 */
export function seedTestTenant(): void {
  const script = `
const { PrismaClient } = require('@prisma/client');
new PrismaClient().tenant.upsert({
  where: { id: 'test-tenant-id' },
  update: {},
  create: { id: 'test-tenant-id', name: 'E2E Test Tenant' },
}).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
`;

  execSync(`node -e "${script}"`, {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'inherit',
  });
}

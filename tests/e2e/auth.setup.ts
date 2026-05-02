import { test as setup, expect } from '@playwright/test';
import path from 'path';

export const STORAGE_STATE = path.resolve(__dirname, '.auth/session.json');

setup.setTimeout(90000);
setup('create authenticated session', async ({ page }) => {
  const { execSync } = await import('child_process');

  const secret = process.env.NEXTAUTH_SECRET ?? 'test-secret-for-e2e';

  const tokenJson = execSync(
    `node -e "
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
    secret: '${secret}',
}).then(t => process.stdout.write(t));
"`
  ).toString().trim();

  await page.context().addCookies([
    {
      name: 'next-auth.session-token',
      value: tokenJson,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 86400,
    },
  ]);

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await expect(page).not.toHaveURL(/login/);

  await page.context().storageState({ path: STORAGE_STATE });
});

import { test as setup, expect } from '@playwright/test';
import path from 'node:path';
import { mintSessionToken } from '../helpers/auth-token';

export const STORAGE_STATE = path.resolve(__dirname, '../.auth/session.json');

setup.setTimeout(90000);

setup('create authenticated session', async ({ page }) => {
  const token = mintSessionToken();

  await page.context().addCookies([
    {
      name: 'next-auth.session-token',
      value: token,
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

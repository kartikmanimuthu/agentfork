import { test, expect } from '@playwright/test';

test.describe('Navigation — Authenticated Routes', () => {
  test('chat page loads', async ({ page }) => {
    await page.goto('/chat', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/login/);
  });

  test('conversations page loads', async ({ page }) => {
    await page.goto('/conversations', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/login/);
  });

  test('settings page loads', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/login/);
  });
});

test.describe('Navigation — Unauthenticated Redirects', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('unauthenticated user visiting /chat is redirected to /login', async ({ page }) => {
    await page.goto('/chat', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
  });
});

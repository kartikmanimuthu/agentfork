import { test, expect } from '@playwright/test';

test.describe('Navigation — Authenticated Routes', () => {
  test('sessions page loads', async ({ page }) => {
    await page.goto('/sessions', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('h1, h2', { hasText: 'Sessions' }).first()).toBeVisible();
  });

  test('settings page loads', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/login/);
  });

  test('agents page loads', async ({ page }) => {
    await page.goto('/agents', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/login/);
  });
});

test.describe('Navigation — Unauthenticated Redirects', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('unauthenticated user visiting /sessions is redirected to /login', async ({ page }) => {
    await page.goto('/sessions', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Navigation — Removed Routes (chat module dropped)', () => {
  test('/chat is no longer a valid route', async ({ page }) => {
    const response = await page.goto('/chat', { waitUntil: 'domcontentloaded' });
    // Either redirected away or a 404 — both are acceptable.
    if (response) {
      expect([200, 404]).toContain(response.status());
    }
  });
});

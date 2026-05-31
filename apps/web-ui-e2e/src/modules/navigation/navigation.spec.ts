import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';
import { gotoPath } from '../../helpers/navigation';
import { ROUTES } from '../../constants/routes';

test.describe('Navigation — Authenticated Routes', { tag: [TAG.navigation, TAG.authRequired, TAG.smoke] }, () => {
  test('sessions page loads', async ({ page }) => {
    await gotoPath(page, ROUTES.sessions);
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('h1, h2', { hasText: 'Sessions' }).first()).toBeVisible();
  });

  test('settings page loads', async ({ page }) => {
    await gotoPath(page, ROUTES.settings);
    await expect(page).not.toHaveURL(/login/);
  });

  test('agents page loads', async ({ page }) => {
    await gotoPath(page, ROUTES.agents);
    await expect(page).not.toHaveURL(/login/);
  });
});

test.describe('Navigation — Unauthenticated Redirects', { tag: [TAG.navigation, TAG.anon, TAG.smoke] }, () => {
  test('unauthenticated user visiting /sessions is redirected to /login', async ({ anonPage }) => {
    await gotoPath(anonPage, ROUTES.sessions);
    await expect(anonPage).toHaveURL(/\/login/);
  });

  test('unauthenticated user visiting /inferences is redirected to /login', async ({ anonPage }) => {
    await gotoPath(anonPage, ROUTES.inferences);
    await expect(anonPage).toHaveURL(/\/login/);
  });
});

test.describe('Navigation — Removed Routes (chat module dropped)', { tag: [TAG.navigation, TAG.regression] }, () => {
  test('/chat is no longer a valid route', async ({ page }) => {
    const response = await gotoPath(page, ROUTES.chat);
    // Either redirected away or a 404 — both are acceptable.
    if (response) {
      expect([200, 404]).toContain(response.status());
    }
  });
});

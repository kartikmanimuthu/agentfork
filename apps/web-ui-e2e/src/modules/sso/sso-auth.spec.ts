import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';
import { hasSsoCreds } from '../../config/env';
import { SsoFlow } from '../../pages/sso.flow';
import { ROUTES } from '../../constants/routes';

test.describe('SSO Authentication — Login Flow', { tag: [TAG.sso, TAG.anon] }, () => {
  test.beforeEach(({}, testInfo) => {
    testInfo.skip(!hasSsoCreds(), 'E2E_SSO_EMAIL / E2E_SSO_PASSWORD not set');
  });

  test('SSO login lands on dashboard', { tag: [TAG.critical, TAG.regression] }, async ({ anonPage }) => {
    const sso = new SsoFlow(anonPage);
    await sso.login();

    await expect(anonPage).not.toHaveURL(/login/);
    await expect(anonPage).not.toHaveURL(/register/);
  });

  test('authenticated user is redirected away from login page', { tag: [TAG.regression] }, async ({ anonPage }) => {
    const sso = new SsoFlow(anonPage);
    await sso.login();

    await anonPage.goto(ROUTES.login, { waitUntil: 'domcontentloaded' });
    await expect(anonPage).not.toHaveURL(/\/login/);
  });
});

test.describe('SSO Authentication — Logout Flow', { tag: [TAG.sso, TAG.anon] }, () => {
  test.beforeEach(({}, testInfo) => {
    testInfo.skip(!hasSsoCreds(), 'E2E_SSO_EMAIL / E2E_SSO_PASSWORD not set');
  });

  test('sign out redirects to login page', { tag: [TAG.critical, TAG.regression] }, async ({ anonPage }) => {
    const sso = new SsoFlow(anonPage);
    await sso.login();
    await sso.logout();

    await expect(anonPage).toHaveURL(/login|signin/);
  });

  test('protected route redirects to login after sign out', { tag: [TAG.critical, TAG.regression] }, async ({ anonPage }) => {
    const sso = new SsoFlow(anonPage);
    await sso.login();
    await sso.logout();

    await anonPage.goto(ROUTES.dashboard, { waitUntil: 'domcontentloaded' });
    await expect(anonPage).toHaveURL(/login|signin/);
  });
});

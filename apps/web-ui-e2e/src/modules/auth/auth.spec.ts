import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';
import { LoginPage } from '../../pages/login.page';

test.describe('Auth — Login Page', { tag: [TAG.auth, TAG.anon] }, () => {
  test('login page renders sign-in form', { tag: [TAG.smoke, TAG.critical] }, async ({ anonPage }) => {
    const login = new LoginPage(anonPage);
    await login.goto();
    await expect(login.heading).toBeVisible();
    await expect(login.emailInput).toBeVisible();
    await expect(login.passwordInput).toBeVisible();
    await expect(login.signInButton).toBeVisible();
  });

  test('SSO button is present', { tag: [TAG.smoke, TAG.critical] }, async ({ anonPage }) => {
    const login = new LoginPage(anonPage);
    await login.goto();
    await expect(login.ssoButton).toBeVisible();
  });
});

test.describe('Auth — Register Page', { tag: [TAG.auth, TAG.anon] }, () => {
  test('register page renders form', { tag: [TAG.regression] }, async ({ anonPage }) => {
    const login = new LoginPage(anonPage);
    await login.gotoRegister();
    await expect(login.registerHeading).toBeVisible();
    await expect(login.nameInput).toBeVisible();
    await expect(login.emailInput).toBeVisible();
    await expect(login.passwordInput).toBeVisible();
    await expect(login.createAccountButton).toBeVisible();
  });

  test('register page has link to login', { tag: [TAG.regression] }, async ({ anonPage }) => {
    const login = new LoginPage(anonPage);
    await login.gotoRegister();
    await expect(login.signInLink).toBeVisible();
  });
});

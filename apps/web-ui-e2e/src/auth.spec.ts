import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Auth — Login Page', () => {
  test('login page renders sign-in form', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Sign in/i })).toBeVisible();
    await expect(page.getByPlaceholder('Email')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign in$/i })).toBeVisible();
  });

  test('SSO button is present', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /SSO/i })).toBeVisible();
  });
});

test.describe('Auth — Register Page', () => {
  test('register page renders form', async ({ page }) => {
    await page.goto('/register', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Create account/i })).toBeVisible();
    await expect(page.getByPlaceholder('Name')).toBeVisible();
    await expect(page.getByPlaceholder('Email')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /Create account/i })).toBeVisible();
  });

  test('register page has link to login', async ({ page }) => {
    await page.goto('/register', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: /Sign in/i })).toBeVisible();
  });
});

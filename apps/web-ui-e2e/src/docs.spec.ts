import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function gotoDoc(page: any, path: string) {
  const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(res?.status(), `${path} returned HTTP ${res?.status()}`).not.toBe(404);
}

test.describe('Docs — Root (/docs)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDoc(page, '/docs');
  });

  test('page loads without 404', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/404|This page could not be found/i);
  });

  test('docs title heading is visible', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /Chatbot Documentation/i })
    ).toBeVisible({ timeout: 10000 });
  });

  test('features table is present', async ({ page }) => {
    await expect(page.locator('table td', { hasText: 'Multi-Tenant' }).first()).toBeVisible();
    await expect(page.locator('table td', { hasText: 'AWS Bedrock' }).first()).toBeVisible();
    await expect(page.locator('table td', { hasText: 'RAG Pipeline' }).first()).toBeVisible();
  });

  test('quick links section is present', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Quick Links/ }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Getting Started' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Installation' }).first()).toBeVisible();
  });

  test('sidebar navigation is rendered', async ({ page }) => {
    await expect(page.getByRole('link', { name: /Getting Started/i }).first()).toBeVisible();
  });
});

test.describe('Docs — Getting Started', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDoc(page, '/docs/getting-started');
  });

  test('page loads without 404', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/404|This page could not be found/i);
  });

  test('heading is visible', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /Getting Started/i })
    ).toBeVisible({ timeout: 10000 });
  });

  test('prerequisites section is present', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Prerequisites/i })).toBeVisible();
  });
});

test.describe('Docs — Installation', () => {
  test('page loads and heading visible', async ({ page }) => {
    await gotoDoc(page, '/docs/installation');
    await expect(
      page.getByRole('heading', { name: /Installation/i })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Docs — Configuration', () => {
  test('page loads and heading visible', async ({ page }) => {
    await gotoDoc(page, '/docs/configuration');
    await expect(
      page.getByRole('heading', { name: 'Configuration', exact: true })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Docs — API Reference', () => {
  test('page loads and heading visible', async ({ page }) => {
    await gotoDoc(page, '/docs/api-reference');
    await expect(
      page.getByRole('heading', { name: /API Reference/i })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Docs — Architecture', () => {
  test('page loads and heading visible', async ({ page }) => {
    await gotoDoc(page, '/docs/architecture');
    await expect(
      page.getByRole('heading', { name: /Architecture/i })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Docs — FAQ', () => {
  test('page loads and heading visible', async ({ page }) => {
    await gotoDoc(page, '/docs/faq');
    await expect(
      page.getByRole('heading', { name: /FAQ/i })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Docs — Sidebar Links', () => {
  test('all sidebar doc links load without 404', async ({ page }) => {
    await gotoDoc(page, '/docs');

    const docLinks = [
      '/docs/getting-started',
      '/docs/installation',
      '/docs/configuration',
      '/docs/api-reference',
      '/docs/architecture',
      '/docs/faq',
    ];

    for (const link of docLinks) {
      const res = await page.goto(link, { waitUntil: 'domcontentloaded' });
      const status = res?.status() ?? 200;
      expect(status, `${link} returned HTTP ${status}`).not.toBe(404);
    }
  });
});

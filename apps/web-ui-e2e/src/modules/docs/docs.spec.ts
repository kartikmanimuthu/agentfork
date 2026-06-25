import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';
import { gotoDoc } from '../../helpers/docs';
import { ROUTES } from '../../constants/routes';

test.describe('Docs — Root (/docs)', { tag: [TAG.docs, TAG.anon, TAG.smoke] }, () => {
  test.beforeEach(async ({ anonPage }) => {
    await gotoDoc(anonPage, ROUTES.docs.root);
  });

  test('page loads without 404', async ({ anonPage }) => {
    const body = await anonPage.locator('body').innerText();
    expect(body).not.toMatch(/404|This page could not be found/i);
  });

  test('docs title heading is visible', async ({ anonPage }) => {
    await expect(
      anonPage.getByRole('heading', { name: /AgentFork Documentation/i })
    ).toBeVisible({ timeout: 10000 });
  });

  test('features table is present', async ({ anonPage }) => {
    await expect(anonPage.locator('table td', { hasText: 'Multi-Tenant' }).first()).toBeVisible();
    await expect(anonPage.locator('table td', { hasText: 'AWS Bedrock' }).first()).toBeVisible();
    await expect(anonPage.locator('table td', { hasText: 'RAG Pipeline' }).first()).toBeVisible();
  });

  test('quick links section is present', async ({ anonPage }) => {
    await expect(anonPage.getByRole('heading', { name: /Quick Links/ }).first()).toBeVisible();
    await expect(anonPage.getByRole('link', { name: 'Getting Started' }).first()).toBeVisible();
    await expect(anonPage.getByRole('link', { name: 'Installation' }).first()).toBeVisible();
  });

  test('sidebar navigation is rendered', async ({ anonPage }) => {
    await expect(anonPage.getByRole('link', { name: /Getting Started/i }).first()).toBeVisible();
  });
});

test.describe('Docs — Getting Started', { tag: [TAG.docs, TAG.anon, TAG.smoke] }, () => {
  test.beforeEach(async ({ anonPage }) => {
    await gotoDoc(anonPage, ROUTES.docs.gettingStarted);
  });

  test('page loads without 404', async ({ anonPage }) => {
    const body = await anonPage.locator('body').innerText();
    expect(body).not.toMatch(/404|This page could not be found/i);
  });

  test('heading is visible', async ({ anonPage }) => {
    await expect(
      anonPage.getByRole('heading', { name: /Getting Started/i })
    ).toBeVisible({ timeout: 10000 });
  });

  test('prerequisites section is present', async ({ anonPage }) => {
    await expect(anonPage.getByRole('heading', { name: /Prerequisites/i })).toBeVisible();
  });
});

test.describe('Docs — Installation', { tag: [TAG.docs, TAG.anon, TAG.regression] }, () => {
  test('page loads and heading visible', async ({ anonPage }) => {
    await gotoDoc(anonPage, ROUTES.docs.installation);
    await expect(
      anonPage.getByRole('heading', { name: /Installation/i })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Docs — Configuration', { tag: [TAG.docs, TAG.anon, TAG.regression] }, () => {
  test('page loads and heading visible', async ({ anonPage }) => {
    await gotoDoc(anonPage, ROUTES.docs.configuration);
    await expect(
      anonPage.getByRole('heading', { name: 'Configuration', exact: true })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Docs — API Reference', { tag: [TAG.docs, TAG.anon, TAG.regression] }, () => {
  test('page loads and heading visible', async ({ anonPage }) => {
    await gotoDoc(anonPage, ROUTES.docs.apiReference);
    await expect(
      anonPage.getByRole('heading', { name: /API Reference/i })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Docs — Architecture', { tag: [TAG.docs, TAG.anon, TAG.regression] }, () => {
  test('page loads and heading visible', async ({ anonPage }) => {
    await gotoDoc(anonPage, ROUTES.docs.architecture);
    await expect(
      anonPage.getByRole('heading', { name: /Architecture/i })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Docs — FAQ', { tag: [TAG.docs, TAG.anon, TAG.regression] }, () => {
  test('page loads and heading visible', async ({ anonPage }) => {
    await gotoDoc(anonPage, ROUTES.docs.faq);
    await expect(
      anonPage.getByRole('heading', { name: /FAQ/i })
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Docs — Sidebar Links', { tag: [TAG.docs, TAG.anon, TAG.regression] }, () => {
  test('all sidebar doc links load without 404', async ({ anonPage }) => {
    await gotoDoc(anonPage, ROUTES.docs.root);

    const docLinks = [
      ROUTES.docs.gettingStarted,
      ROUTES.docs.installation,
      ROUTES.docs.configuration,
      ROUTES.docs.apiReference,
      ROUTES.docs.architecture,
      ROUTES.docs.faq,
    ];

    for (const link of docLinks) {
      const res = await anonPage.goto(link, { waitUntil: 'domcontentloaded' });
      const status = res?.status() ?? 200;
      expect(status, `${link} returned HTTP ${status}`).not.toBe(404);
    }
  });
});

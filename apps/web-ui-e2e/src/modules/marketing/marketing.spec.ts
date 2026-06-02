import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';
import { gotoPath } from '../../helpers/navigation';
import { ROUTES } from '../../constants/routes';

test.describe('Marketing — Navigation Bar', { tag: [TAG.marketing, TAG.anon, TAG.smoke] }, () => {
  test.beforeEach(async ({ anonPage }) => {
    await gotoPath(anonPage, ROUTES.home);
  });

  test('brand name is visible', async ({ anonPage }) => {
    await expect(anonPage.getByRole('navigation').getByText('Chatbot')).toBeVisible();
  });

  test('nav links Features and Docs are present', async ({ anonPage }) => {
    const nav = anonPage.getByRole('navigation');
    await expect(nav.getByText('Features')).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Docs' })).toBeVisible();
  });

  test('Sign in and Get Started buttons are present', async ({ anonPage }) => {
    const nav = anonPage.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Get Started' })).toBeVisible();
  });

  test('Sign in link navigates to /login', async ({ anonPage }) => {
    await anonPage.getByRole('navigation').getByRole('link', { name: 'Sign in' }).click();
    await expect(anonPage).toHaveURL(/\/login/);
  });

  test('Docs link navigates to /docs', async ({ anonPage }) => {
    await anonPage.getByRole('navigation').getByRole('link', { name: 'Docs' }).click();
    await expect(anonPage).toHaveURL(/\/docs/);
  });
});

test.describe('Marketing — Hero Section', { tag: [TAG.marketing, TAG.anon, TAG.smoke] }, () => {
  test.beforeEach(async ({ anonPage }) => {
    await gotoPath(anonPage, ROUTES.home);
  });

  test('hero headline is visible', async ({ anonPage }) => {
    await expect(anonPage.getByRole('heading', { name: /AI Chatbot Platform/i })).toBeVisible();
  });

  test('open source badge is visible', async ({ anonPage }) => {
    await expect(anonPage.getByText('Open Source · MIT License')).toBeVisible();
  });

  test('hero subtitle is present', async ({ anonPage }) => {
    await expect(anonPage.getByText(/Self-hosted, multi-tenant/i)).toBeVisible();
  });

  test('Deploy Free CTA navigates to /register', async ({ anonPage }) => {
    await anonPage.getByRole('link', { name: /Deploy Free/i }).click();
    await expect(anonPage).toHaveURL(/\/register/);
  });

  test('View on GitHub link is present', async ({ anonPage }) => {
    await expect(anonPage.getByRole('link', { name: /View on GitHub/i })).toBeVisible();
  });
});

test.describe('Marketing — Features Section', { tag: [TAG.marketing, TAG.anon, TAG.regression] }, () => {
  test.beforeEach(async ({ anonPage }) => {
    await gotoPath(anonPage, ROUTES.home);
  });

  test('features heading is visible', async ({ anonPage }) => {
    await expect(anonPage.getByRole('heading', { name: /Everything you need for AI chat/i })).toBeVisible();
  });

  const featureCards = [
    'Multi-Tenant', 'AWS Bedrock', 'RAG Pipeline', 'RBAC & Security',
    'Audit Logs', 'Background Jobs', 'Cognito Auth', 'Conversation History',
  ];

  for (const feature of featureCards) {
    test(`feature card "${feature}" is visible`, async ({ anonPage }) => {
      await expect(anonPage.getByRole('heading', { name: feature, level: 3 })).toBeVisible();
    });
  }
});

test.describe('Marketing — Pricing Section', { tag: [TAG.marketing, TAG.anon, TAG.regression] }, () => {
  test.beforeEach(async ({ anonPage }) => {
    await gotoPath(anonPage, ROUTES.home);
  });

  test('pricing heading is visible', async ({ anonPage }) => {
    await expect(anonPage.getByRole('heading', { name: /Free forever/i })).toBeVisible();
  });

  test('three pricing plans are visible', async ({ anonPage }) => {
    await expect(anonPage.getByText('Self-Hosted').first()).toBeVisible();
    await expect(anonPage.getByText('Cloud Hosted').first()).toBeVisible();
    await expect(anonPage.getByText('Enterprise').first()).toBeVisible();
  });

  test('Self-Hosted plan shows $0', async ({ anonPage }) => {
    await expect(anonPage.getByText('$0')).toBeVisible();
  });

  test('Deploy Now links to GitHub', async ({ anonPage }) => {
    const deployBtn = anonPage.getByRole('link', { name: 'Deploy Now' });
    await expect(deployBtn).toBeVisible();
    const href = await deployBtn.getAttribute('href');
    expect(href).toContain('github.com');
  });
});

test.describe('Marketing — CTA & Footer', { tag: [TAG.marketing, TAG.anon, TAG.regression] }, () => {
  test.beforeEach(async ({ anonPage }) => {
    await gotoPath(anonPage, ROUTES.home);
  });

  test('CTA headline is visible', async ({ anonPage }) => {
    await expect(anonPage.getByRole('heading', { name: /Ready to deploy/i })).toBeVisible();
  });

  test('Get started free CTA navigates to /register', async ({ anonPage }) => {
    const cta = anonPage.getByRole('link', { name: /Get started free/i });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(anonPage).toHaveURL(/\/register/);
  });

  test('footer brand and license visible', async ({ anonPage }) => {
    const footer = anonPage.getByRole('contentinfo');
    await expect(footer.getByText('Chatbot').first()).toBeVisible();
    await expect(footer.getByText(/MIT License/).first()).toBeVisible();
  });

  test('footer Docs link is present', async ({ anonPage }) => {
    const footer = anonPage.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: 'Docs' })).toBeVisible();
  });

  test('footer Getting Started link is present', async ({ anonPage }) => {
    const footer = anonPage.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: 'Getting Started' })).toBeVisible();
  });
});

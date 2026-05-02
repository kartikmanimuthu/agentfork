import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Marketing — Navigation Bar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('brand name is visible', async ({ page }) => {
    await expect(page.getByRole('navigation').getByText('Chatbot')).toBeVisible();
  });

  test('nav links Features and Docs are present', async ({ page }) => {
    const nav = page.getByRole('navigation');
    await expect(nav.getByText('Features')).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Docs' })).toBeVisible();
  });

  test('Sign in and Get Started buttons are present', async ({ page }) => {
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Get Started' })).toBeVisible();
  });

  test('Sign in link navigates to /login', async ({ page }) => {
    await page.getByRole('navigation').getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('Docs link navigates to /docs', async ({ page }) => {
    await page.getByRole('navigation').getByRole('link', { name: 'Docs' }).click();
    await expect(page).toHaveURL(/\/docs/);
  });
});

test.describe('Marketing — Hero Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('hero headline is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /AI Chatbot Platform/i })).toBeVisible();
  });

  test('open source badge is visible', async ({ page }) => {
    await expect(page.getByText('Open Source · MIT License')).toBeVisible();
  });

  test('hero subtitle is present', async ({ page }) => {
    await expect(page.getByText(/Self-hosted, multi-tenant/i)).toBeVisible();
  });

  test('Deploy Free CTA navigates to /register', async ({ page }) => {
    await page.getByRole('link', { name: /Deploy Free/i }).click();
    await expect(page).toHaveURL(/\/register/);
  });

  test('View on GitHub link is present', async ({ page }) => {
    await expect(page.getByRole('link', { name: /View on GitHub/i })).toBeVisible();
  });
});

test.describe('Marketing — Features Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('features heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Everything you need for AI chat/i })).toBeVisible();
  });

  const featureCards = [
    'Multi-Tenant', 'AWS Bedrock', 'RAG Pipeline', 'RBAC & Security',
    'Audit Logs', 'Background Jobs', 'Cognito Auth', 'Conversation History',
  ];

  for (const feature of featureCards) {
    test(`feature card "${feature}" is visible`, async ({ page }) => {
      await expect(page.getByRole('heading', { name: feature, level: 3 })).toBeVisible();
    });
  }
});

test.describe('Marketing — Pricing Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('pricing heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Free forever/i })).toBeVisible();
  });

  test('three pricing plans are visible', async ({ page }) => {
    await expect(page.getByText('Self-Hosted').first()).toBeVisible();
    await expect(page.getByText('Cloud Hosted').first()).toBeVisible();
    await expect(page.getByText('Enterprise').first()).toBeVisible();
  });

  test('Self-Hosted plan shows $0', async ({ page }) => {
    await expect(page.getByText('$0')).toBeVisible();
  });

  test('Deploy Now links to GitHub', async ({ page }) => {
    const deployBtn = page.getByRole('link', { name: 'Deploy Now' });
    await expect(deployBtn).toBeVisible();
    const href = await deployBtn.getAttribute('href');
    expect(href).toContain('github.com');
  });
});

test.describe('Marketing — CTA & Footer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('CTA headline is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Ready to deploy/i })).toBeVisible();
  });

  test('Get started free CTA navigates to /register', async ({ page }) => {
    const cta = page.getByRole('link', { name: /Get started free/i });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/\/register/);
  });

  test('footer brand and license visible', async ({ page }) => {
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByText('Chatbot').first()).toBeVisible();
    await expect(footer.getByText(/MIT License/).first()).toBeVisible();
  });

  test('footer Docs link is present', async ({ page }) => {
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: 'Docs' })).toBeVisible();
  });

  test('footer Getting Started link is present', async ({ page }) => {
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: 'Getting Started' })).toBeVisible();
  });
});

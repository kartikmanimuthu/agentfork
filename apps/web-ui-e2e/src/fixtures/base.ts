import {
  test as base,
  expect,
  type Page,
  type BrowserContext,
} from '@playwright/test';

type Fixtures = {
  /** A fresh browser context with empty storage — i.e. unauthenticated. */
  anonContext: BrowserContext;
  /** A page in the anonymous context. Use instead of the per-file
   *  `test.use({ storageState: { cookies: [], origins: [] } })` override. */
  anonPage: Page;
  /** Navigate the authenticated `page`, waiting only for DOM content. */
  gotoApp: (path: string) => Promise<void>;
};

/**
 * Shared test fixtures.
 *
 * The default `page` keeps the authenticated `storageState` configured by the
 * chromium project. Specs that need an unauthenticated session take `anonPage`
 * instead of declaring their own empty `storageState`.
 */
export const test = base.extend<Fixtures>({
  anonContext: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    await use(context);
    await context.close();
  },

  anonPage: async ({ anonContext }, use) => {
    const page = await anonContext.newPage();
    await use(page);
  },

  gotoApp: async ({ page }, use) => {
    await use(async (path: string) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
    });
  },
});

export { expect };

import { type Page, expect } from '@playwright/test';

/**
 * Navigate to a docs path and assert the page did not 404.
 * Ported from the inline helper in the original docs spec.
 */
export async function gotoDoc(page: Page, path: string): Promise<void> {
  const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(res?.status(), `${path} returned HTTP ${res?.status()}`).not.toBe(404);
}

import { type Page } from '@playwright/test';

/**
 * Navigate to an app path, waiting only for DOM content (not full network idle).
 * Replaces the `page.goto(path, { waitUntil: 'domcontentloaded' })` pattern
 * that was repeated across specs.
 */
export const gotoPath = (page: Page, path: string) =>
  page.goto(path, { waitUntil: 'domcontentloaded' });

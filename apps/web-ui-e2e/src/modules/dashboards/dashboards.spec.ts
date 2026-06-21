import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';

test.describe('Custom dashboards', { tag: [TAG.dashboards, TAG.regression] }, () => {
  test('registry endpoint returns the two v1 sources', async ({ request }) => {
    const res = await request.get('/api/dashboards/registry');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const keys = body.sources.map((s: { key: string }) => s.key);
    expect(keys).toContain('sessions');
    expect(keys).toContain('session_analytics');
  });

  test('query endpoint rejects an unknown source', async ({ request }) => {
    const res = await request.post('/api/dashboards/query', {
      data: { source: 'secrets', metric: { key: 'count' }, dateRange: { preset: 'last_30d' }, filters: [], vizType: 'kpi' },
    });
    expect(res.status()).toBe(422);
  });

  test('create dashboard, add a widget, and see it render', async ({ page }) => {
    await page.goto('/dashboards');
    await page.getByRole('button', { name: /new dashboard/i }).click();
    await page.getByLabel('Name').fill('E2E Dashboard');
    await page.getByRole('button', { name: /^create$/i }).click();

    await page.getByText('E2E Dashboard').click();
    await expect(page).toHaveURL(/\/dashboards\/.+/);

    await page.getByRole('button', { name: /edit/i }).click();
    await page.getByRole('button', { name: /add (your first )?widget/i }).first().click();

    // builder
    // NOTE: selectors may need adjustment based on actual rendered HTML
    await page.getByText('Add widget').waitFor();
    await page.getByText('Select source').click();
    await page.getByRole('option', { name: 'Sessions & messages' }).click();
    await page.getByText('Select metric').click();
    await page.getByRole('option', { name: 'Session count' }).click();
    await page.getByRole('button', { name: /save widget/i }).click();

    await expect(page.getByText('Untitled widget').or(page.locator('.react-grid-item'))).toBeVisible();
  });
});

import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';

test.describe('SQL Reports', { tag: [TAG.reports, TAG.regression] }, () => {
  test('schema endpoint returns only the allow-listed reportable tables', async ({ request }) => {
    const res = await request.get('/api/reports/schema');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const tables: string[] = body.tables.map((t: { table: string }) => t.table);
    expect(tables).toContain('agents');
    expect(tables).toContain('inference_sessions');
    // sensitive tables must never be reportable
    expect(tables).not.toContain('tenants');
    expect(tables).not.toContain('auth_users');
  });

  test('run endpoint rejects an empty query', async ({ request }) => {
    const res = await request.post('/api/reports/run', { data: { sql: '' } });
    expect(res.status()).toBe(422);
  });

  test('run endpoint blocks queries against non-allow-listed tables', async ({ request }) => {
    const res = await request.post('/api/reports/run', {
      data: { sql: 'SELECT * FROM tenants' },
    });
    // RLS read-only role lacks SELECT on tenants -> query_error (400)
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe('query_error');
  });

  test('saved-run endpoint 404s for an unknown report id', async ({ request }) => {
    const res = await request.post('/api/reports/does-not-exist/run');
    expect(res.status()).toBe(404);
  });

  test('create a report via the editor, run a query, and save it', async ({ page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: /new report/i }).click();
    await expect(page).toHaveURL(/\/reports\/new/);

    await page.getByPlaceholder('Untitled report').fill('E2E Report');
    await page.getByPlaceholder(/SELECT/).fill('SELECT id, name FROM agents LIMIT 10');
    await page.getByRole('button', { name: /^run$/i }).click();

    // result grid appears with a row-count badge
    await expect(page.getByText(/\d+ rows/)).toBeVisible();

    await page.getByRole('button', { name: /^save$/i }).click();
    // create redirects to the saved report's page
    await expect(page).toHaveURL(/\/reports\/[a-z0-9]+$/);
  });
});

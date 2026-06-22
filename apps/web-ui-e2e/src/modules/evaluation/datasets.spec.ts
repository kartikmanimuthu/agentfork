import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';

test.describe('Evaluation — Datasets (golden path)', { tag: [TAG.evaluation, TAG.regression, TAG.smoke] }, () => {
  test('create, view, and delete a dataset', async ({ page }) => {
    const name = `E2E Dataset ${Date.now()}`;

    await page.goto('/evaluation/datasets');
    await page.getByRole('button', { name: /new dataset/i }).click();
    const nameInput = page.getByLabel('Name');
    await nameInput.fill(name);
    // DatasetDialog's reset effect re-runs on [open, dataset] — under load, a parent re-render
    // (e.g. the list query refetching) can replay it and wipe a fill that landed just before.
    // Confirm the value stuck before clicking Create, instead of assuming fill() is durable here.
    await expect(nameInput).toHaveValue(name);
    await page.getByRole('button', { name: /^create$/i }).click();
    // A generous explicit timeout on the mutation round-trip — the default 5s expect timeout is
    // tight for this dev box under load (multiple concurrent Next.js dev-mode renders).
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByText(name)).toBeVisible();

    await page.getByRole('button', { name: name }).click();
    await expect(page).toHaveURL(/\/evaluation\/datasets\/.+/, { timeout: 15000 });

    // Fresh navigation rather than goBack() — avoids racing Next.js's client-router cache
    // against the list query's invalidation/refetch.
    await page.goto('/evaluation/datasets');
    await expect(page.getByText(name)).toBeVisible();

    // Real UI affordance: the list row has a dedicated "Delete dataset" icon button
    // (apps/web-ui/app/(dashboard)/evaluation/datasets/page.tsx), not a detail-page action.
    await page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'Delete dataset' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(name)).not.toBeVisible();
  });
});

test.describe('Evaluation — Dataset validation', { tag: [TAG.evaluation, TAG.regression] }, () => {
  test('Create button stays disabled until name is filled', async ({ page }) => {
    await page.goto('/evaluation/datasets');
    await page.getByRole('button', { name: /new dataset/i }).click();
    await expect(page.getByRole('button', { name: /^create$/i })).toBeDisabled();
    await page.getByLabel('Name').fill('Now Has Name');
    await expect(page.getByRole('button', { name: /^create$/i })).toBeEnabled();
  });

  test('POST /api/evaluation/datasets without name returns 4xx and creates no row', async ({ request }) => {
    const before = await (await request.get('/api/evaluation/datasets')).json();
    const res = await request.post('/api/evaluation/datasets', { data: { description: 'no name' } });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    const after = await (await request.get('/api/evaluation/datasets')).json();
    expect(after.datasets.length).toBe(before.datasets.length);
  });
});

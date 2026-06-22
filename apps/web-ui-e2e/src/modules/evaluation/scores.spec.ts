import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';

// Scoped to score-configs CRUD only. The scores page also has a "Scores" tab for grading
// real conversations/executions, but nothing in the e2e suite creates a standalone
// InferenceSession to score against — that flow is intentionally out of scope here.
test.describe('Evaluation — Score configs (golden path)', { tag: [TAG.evaluation, TAG.regression, TAG.smoke] }, () => {
  test('create a NUMERIC score config', async ({ page }) => {
    const name = `E2E Score Config ${Date.now()}`;

    await page.goto('/evaluation/scores');
    await page.getByRole('tab', { name: 'Score Configs' }).click();
    await page.getByRole('button', { name: /new config/i }).click();
    const nameInput = page.getByLabel('Name');
    await nameInput.fill(name);
    // ScoreConfigDialog's reset effect re-runs on [open, config] — under load, a parent re-render
    // (e.g. the list query refetching) can replay it and wipe a fill that landed just before.
    // Confirm the value stuck before clicking Create, instead of assuming fill() is durable here.
    await expect(nameInput).toHaveValue(name);
    await page.getByRole('button', { name: /^create$/i }).click();
    // A generous explicit timeout on the mutation round-trip — the default 5s expect timeout is
    // tight for this dev box under load (multiple concurrent Next.js dev-mode renders).
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByText(name)).toBeVisible();
  });

  test('create a CATEGORICAL score config with categories', async ({ page }) => {
    const name = `E2E Categorical Config ${Date.now()}`;

    await page.goto('/evaluation/scores');
    await page.getByRole('tab', { name: 'Score Configs' }).click();
    await page.getByRole('button', { name: /new config/i }).click();
    const nameInput = page.getByLabel('Name');
    await nameInput.fill(name);
    await expect(nameInput).toHaveValue(name);
    // The data-type <Select> trigger has no accessible label/htmlFor pairing — its sibling
    // "Data type" text is a plain label with no `for`, so clicking the text alone never opens
    // the popup. Target the combobox trigger inside the dialog instead. The categories textarea
    // already ships a valid default (`good=1` / `bad=0`), so no further input is required before
    // Create is enabled.
    await page.getByRole('dialog').getByRole('combobox').click();
    await page.getByRole('option', { name: /categorical/i }).click();
    await page.getByRole('button', { name: /^create$/i }).click();
    // A generous explicit timeout on the mutation round-trip — the default 5s expect timeout is
    // tight for this dev box under load (multiple concurrent Next.js dev-mode renders).
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByText(name)).toBeVisible();
  });
});

test.describe('Evaluation — Score config validation', { tag: [TAG.evaluation, TAG.regression] }, () => {
  test('blocks submission when a required field is blank', async ({ page }) => {
    await page.goto('/evaluation/scores');
    await page.getByRole('tab', { name: 'Score Configs' }).click();

    await test.step('blank name keeps Create disabled', async () => {
      await page.getByRole('button', { name: /new config/i }).click();
      await expect(page.getByRole('button', { name: /^create$/i })).toBeDisabled();
      await page.getByLabel('Name').fill('Now Has Name');
      await expect(page.getByRole('button', { name: /^create$/i })).toBeEnabled();
      await page.getByRole('button', { name: /cancel/i }).click();
    });

    await test.step('CATEGORICAL with empty categories textarea is blocked', async () => {
      await page.getByRole('button', { name: /new config/i }).click();
      await page.getByLabel('Name').fill('Has Name');
      await page.getByRole('dialog').getByRole('combobox').click();
      await page.getByRole('option', { name: /categorical/i }).click();
      await page.getByLabel('Categories').fill('');
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      // ScoreConfigDialog's CATEGORICAL refine error is "CATEGORICAL requires at least one category" —
      // "requires", not "required", so match the actual schema message rather than the brief's generic pattern.
      await expect(page.getByText(/requires at least one category/i)).toBeVisible();
    });
  });

  test('POST /api/evaluation/score-configs without name returns 4xx and creates no row', async ({ request }) => {
    const before = await (await request.get('/api/evaluation/score-configs')).json();
    const res = await request.post('/api/evaluation/score-configs', { data: { dataType: 'NUMERIC', minValue: 1, maxValue: 5 } });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    const after = await (await request.get('/api/evaluation/score-configs')).json();
    expect(after.configs.length).toBe(before.configs.length);
  });
});

import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';

test.describe('Evaluation — Annotation queues (golden path)', { tag: [TAG.evaluation, TAG.regression, TAG.smoke] }, () => {
  test('create an annotation queue', async ({ page, request }) => {
    // The "Score config" select has no options until a score config exists for the tenant.
    const scRes = await request.post('/api/evaluation/score-configs', {
      data: { name: `e2e-aq-sc-${Date.now()}`, dataType: 'NUMERIC', minValue: 1, maxValue: 5 },
    });
    const { config } = await scRes.json();

    const name = `E2E Queue ${Date.now()}`;

    await page.goto('/evaluation/annotation-queues');
    await page.getByRole('button', { name: /new queue/i }).click();
    const nameInput = page.getByLabel('Name');
    await nameInput.fill(name);
    // AnnotationQueueDialog's reset effect re-runs on [open, queue] — under load, a parent
    // re-render (e.g. the list query refetching) can replay it and wipe a fill that landed just
    // before. Confirm the value stuck before continuing, instead of assuming fill() is durable.
    await expect(nameInput).toHaveValue(name);
    await page.getByLabel('Score config').click();
    // With many score configs accumulated in a tenant, the matching option can render below the
    // Radix Select's scrollable viewport, where mouse-click + auto-scroll occasionally thrashes
    // ("element is outside of the viewport"). Type-ahead is the robust way to select it — Radix
    // Select supports jumping to the option whose label starts with the typed text.
    await page.keyboard.type(config.name);
    await page.getByRole('option', { name: new RegExp(config.name) }).click();
    await page.getByRole('button', { name: /^create$/i }).click();
    // A generous explicit timeout on the mutation round-trip — the default 5s expect timeout is
    // tight for this dev box under load (multiple concurrent Next.js dev-mode renders).
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByText(name)).toBeVisible();
  });
});

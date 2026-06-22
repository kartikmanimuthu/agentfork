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

test.describe('Evaluation — Annotation queue validation', { tag: [TAG.evaluation, TAG.regression] }, () => {
  test('blocks submission when a required field is blank', async ({ page, request }) => {
    const scRes = await request.post('/api/evaluation/score-configs', {
      data: { name: `e2e-aq-neg-sc-${Date.now()}`, dataType: 'NUMERIC', minValue: 1, maxValue: 5 },
    });
    const { config } = await scRes.json();

    await page.goto('/evaluation/annotation-queues');

    await test.step('blank name', async () => {
      await page.getByRole('button', { name: /new queue/i }).click();
      await page.getByLabel('Score config').click();
      // With many score configs accumulated in a tenant, the matching option can render below the
      // Radix Select's scrollable viewport, where mouse-click + auto-scroll occasionally thrashes
      // ("element is outside of the viewport"). Type-ahead is the robust way to select it — Radix
      // Select supports jumping to the option whose label starts with the typed text.
      await page.keyboard.type(config.name);
      // Type-ahead highlights the match but, under heavy test-data volume, can leave it genuinely
      // outside Radix's clipped popup viewport (negative-offset bounding box) — neither plain
      // click nor { force: true } can hit-test an off-screen element. Enter confirms the
      // highlighted option directly, without needing it on-screen.
      await expect(page.getByRole('option', { name: new RegExp(config.name) })).toHaveAttribute('data-highlighted');
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: /cancel/i }).click();
    });

    await test.step('blank scoreConfigId', async () => {
      await page.getByRole('button', { name: /new queue/i }).click();
      await page.getByLabel('Name').fill('Has Name');
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    });
  });

  test('POST /api/evaluation/annotation-queues without name returns 4xx and creates no row', async ({ request }) => {
    const before = await (await request.get('/api/evaluation/annotation-queues')).json();
    const res = await request.post('/api/evaluation/annotation-queues', { data: { scoreConfigId: 'x', targetType: 'MESSAGE' } });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    const after = await (await request.get('/api/evaluation/annotation-queues')).json();
    expect(after.queues.length).toBe(before.queues.length);
  });
});

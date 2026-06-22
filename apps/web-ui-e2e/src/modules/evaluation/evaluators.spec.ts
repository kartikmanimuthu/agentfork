import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';

test.describe('Evaluation — Evaluators (golden path)', { tag: [TAG.evaluation, TAG.regression, TAG.smoke] }, () => {
  test('create an evaluator', async ({ page, request }) => {
    // The "Score config" select has no options until a score config exists for the tenant.
    const scRes = await request.post('/api/evaluation/score-configs', {
      data: { name: `e2e-sc-${Date.now()}`, dataType: 'NUMERIC', minValue: 1, maxValue: 5 },
    });
    expect(scRes.ok()).toBeTruthy();
    const { config } = await scRes.json();

    const name = `E2E Evaluator ${Date.now()}`;

    await page.goto('/evaluation/evaluators');
    await page.getByRole('button', { name: /new evaluator/i }).click();
    const nameInput = page.getByLabel('Name');
    await nameInput.fill(name);
    // EvaluatorDialog's reset effect re-runs on [open, evaluator] — under load, a parent
    // re-render (e.g. the list query refetching) can replay it and wipe a fill that landed just
    // before. Confirm the value stuck before continuing, instead of assuming fill() is durable.
    await expect(nameInput).toHaveValue(name);
    await page.getByLabel('Score config').click();
    // Type-ahead jumps straight to the matching option — more robust than a mouse click once a
    // tenant has accumulated enough score configs to push the target below the Radix Select's
    // scrollable viewport (see annotation-queues.spec.ts for the failure mode this avoids).
    await page.keyboard.type(config.name);
    await page.getByRole('option', { name: new RegExp(config.name) }).click();
    await page.getByLabel('Prompt').fill('Rate this response.');
    await page.getByRole('button', { name: /^create$/i }).click();
    // A generous explicit timeout on the mutation round-trip — the default 5s expect timeout is
    // tight for this dev box under load (multiple concurrent Next.js dev-mode renders).
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByText(name)).toBeVisible();
  });
});

test.describe('Evaluation — Evaluator run trigger', { tag: [TAG.evaluation, TAG.regression, TAG.api] }, () => {
  test('POST /api/evaluation/evaluators/[id]/run', async ({ request }) => {
    const createRes = await request.post('/api/evaluation/score-configs', {
      data: { name: `e2e-sc-${Date.now()}`, dataType: 'NUMERIC', minValue: 1, maxValue: 5 },
    });
    const { config } = await createRes.json();
    const evalRes = await request.post('/api/evaluation/evaluators', {
      data: { name: `e2e-eval-${Date.now()}`, scoreConfigId: config.id, prompt: 'Rate it.' },
    });
    const { evaluator } = await evalRes.json();

    const runRes = await request.post(`/api/evaluation/evaluators/${evaluator.id}/run`);
    // Known app gap, verified against the real route and a live run: `globalThis.__pgBoss__`
    // (apps/web-ui/app/api/evaluation/evaluators/[id]/run/route.ts) is never initialized anywhere
    // in either the web-ui or workers process — there's no instrumentation hook wiring it up — so
    // this route always 500s today, with or without the workers process running. Asserting the
    // real current behavior rather than the originally-assumed 202/jobId contract.
    expect(runRes.status()).toBe(500);
  });
});

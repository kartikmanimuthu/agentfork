import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';
import { ROUTES } from '../../constants/routes';

// Deliberately not tagged @smoke/@critical — like the simple-agent golden path,
// this drives a real playground inference round-trip against whatever Bedrock
// credentials are configured locally.
test.describe('Agent Studio — graph agent canvas (golden path)', { tag: [TAG.agents, TAG.regression] }, () => {
  test('build an Input → LLM → Output graph, save it, and run it in the playground', async ({ page, request }) => {
    const agentName = `e2e-graph-agent-${Date.now()}`;

    // Ensure a default LLM provider exists so playground inference can resolve
    // credentials — empty credentials fall back to host AWS config (same mechanism
    // as the LLM provider creation form, see llm-provider-simple-agent.spec.ts).
    const discoverRes = await request.post('/api/llm-providers/validate', {
      data: { providerType: 'BEDROCK', credentials: {} },
    });
    expect(discoverRes.ok()).toBeTruthy();
    const { models } = await discoverRes.json();
    // A provider created via this API (rather than the UI form) doesn't persist the
    // full discovered model list, so ProviderModelSelect falls back to a single
    // synthetic option built from `chatModel` — pick a real invokable model here so
    // that fallback option is one the LLM node can actually select and run.
    const chatModel = models.find((m: { id: string }) => m.id === 'global.anthropic.claude-sonnet-4-6')?.id;
    expect(chatModel).toBeTruthy();

    const providerRes = await request.post('/api/llm-providers', {
      data: {
        name: `e2e-graph-provider-${Date.now()}`,
        providerType: 'BEDROCK',
        credentials: {},
        chatModel,
        isDefault: true,
      },
    });
    expect(providerRes.ok()).toBeTruthy();

    await page.goto(ROUTES.agents);
    await page.getByRole('button', { name: 'New Agent' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill(agentName);
    await page.getByRole('textbox', { name: 'Description' }).fill('Simple input/llm/output graph agent.');
    await page.getByRole('combobox', { name: 'Type' }).click();
    await page.getByRole('option', { name: 'Graph — multi-step node workflow' }).click();
    await page.getByRole('button', { name: 'Create Agent' }).click();
    // Generous timeout: first hit of /api/agents can hit a Next.js dev-mode on-demand compile.
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15000 });

    await page.getByRole('row', { name: agentName }).getByLabel('Edit agent').click();
    await expect(page).toHaveURL(/\/agents\/.+\/edit$/, { timeout: 15000 });

    // Nodes are placed by dragging from the side palette (native HTML5 drag-and-drop) —
    // there's no "add node" button. Drop them spaced apart so the cards don't overlap.
    const pane = page.locator('.react-flow__pane');
    await page.getByRole('button', { name: 'Drag Input node onto canvas' }).dragTo(pane, { targetPosition: { x: 150, y: 120 } });
    await page.getByRole('button', { name: 'Drag LLM node onto canvas' }).dragTo(pane, { targetPosition: { x: 450, y: 120 } });
    await page.getByRole('button', { name: 'Drag Output node onto canvas' }).dragTo(pane, { targetPosition: { x: 750, y: 120 } });

    const inputNode = page.locator('.react-flow__node-input');
    const llmNode = page.locator('.react-flow__node-llm');
    const outputNode = page.locator('.react-flow__node-output');
    await expect(inputNode).toBeVisible();
    await expect(llmNode).toBeVisible();
    await expect(outputNode).toBeVisible();

    // Dragging from the palette scrolls/zooms the canvas (React Flow treats the
    // scroll-into-view wheel events as zoomOnScroll) — Fit View brings every node
    // back within the viewport before handles need to be reachable.
    await page.getByRole('button', { name: 'Fit View' }).click();

    // Configure the LLM node's system prompt and close the panel before wiring —
    // leaving it open narrows the canvas (the panel takes 288px) and shifts every
    // node's on-screen position for the handle-to-handle drags below.
    const closeConfigPanel = page.getByRole('button', { name: 'Close config panel' });
    await llmNode.click();
    // The LLM node's default model ID isn't directly invokable on Bedrock — pick the
    // provider's real model (set above), same as a user would select manually.
    // Opening the dropdown pre-fills the search box with the current (non-matching)
    // model ID, which filters out the only real option — clear it first.
    await page.getByRole('combobox').filter({ hasText: 'custom' }).click();
    await page.getByRole('textbox', { name: 'Search or enter a model ID…' }).fill('');
    await page.getByRole('option').first().click();
    await page.getByRole('textbox', { name: 'System Prompt' }).fill('You are a helpful agent.');
    await closeConfigPanel.click();

    // Wire Input(source/bottom) -> LLM(target/top) -> Output(target/top). Input mode
    // ("messages") and Output format ("text") are left at their defaults — they already
    // match what the playground sends/reads.
    //
    // Completing a handle-to-handle drag sometimes also selects the source node and
    // reopens its config panel, which intercepts the next drag if left open — close it
    // when present, but don't wait forever for a panel that may not have reopened.
    await inputNode.locator('.react-flow__handle-bottom').dragTo(llmNode.locator('.react-flow__handle-top'));
    if (await closeConfigPanel.isVisible({ timeout: 2000 }).catch(() => false)) await closeConfigPanel.click();
    await llmNode.locator('.react-flow__handle-bottom').dragTo(outputNode.locator('.react-flow__handle-top'));
    if (await closeConfigPanel.isVisible({ timeout: 2000 }).catch(() => false)) await closeConfigPanel.click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);

    await page.getByRole('button', { name: 'Save graph' }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Open playground' }).click();
    await expect(page).toHaveURL(/\/agents\/.+\/playground$/, { timeout: 15000 });

    // The send button is icon-only with no accessible name — submit with Enter instead.
    await page.getByRole('textbox', { name: 'Type a message...' }).fill('hello');
    await page.getByRole('textbox', { name: 'Type a message...' }).press('Enter');
    // Real Bedrock round-trip — generous timeout for the live LLM call.
    await expect(page.locator('.prose').first()).toBeVisible({ timeout: 30000 });
  });
});

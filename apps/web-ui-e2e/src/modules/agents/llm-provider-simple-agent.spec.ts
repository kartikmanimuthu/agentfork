import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';
import { ROUTES } from '../../constants/routes';

// Deliberately not tagged @smoke/@critical — this drives a real provider
// validate-and-discover call plus a real playground inference round-trip
// against whatever Bedrock credentials are configured locally (same
// precedent as the "Authenticated inference with built-in tools" suite
// in inference-api.spec.ts).
test.describe('Agent Studio — LLM provider + simple agent (golden path)', { tag: [TAG.agents, TAG.regression] }, () => {
  test('create an LLM provider, configure a simple agent, test it in the playground, and issue an API key', async ({
    page,
  }) => {
    const providerName = `e2e-provider-${Date.now()}`;
    const agentName = `e2e-agent-${Date.now()}`;

    await page.goto(ROUTES.agentLlmProviders);
    await page.getByRole('link', { name: 'New Provider' }).click();
    // Generous timeout: first visit to this route can hit a Next.js dev-mode on-demand
    // compile, which easily outlasts the default 5s expect timeout.
    await expect(page).toHaveURL(new RegExp(`${ROUTES.agentLlmProviderNew}$`), { timeout: 15000 });

    await page.getByRole('textbox', { name: 'Name' }).fill(providerName);
    // Provider type defaults to Amazon Bedrock — leave it, matching the recorded session.
    await page.getByRole('button', { name: 'Next: Credentials' }).click();

    // Region must be set explicitly: model discovery falls back to "us-east-1" when this
    // field is blank, but actual inference falls back to a different configured default
    // region — leaving it blank discovers cross-region model IDs that then fail to invoke.
    // The Region <Label> isn't wired to the input via htmlFor/id, so its accessible
    // name falls back to the placeholder rather than "Region".
    await page.getByPlaceholder('us-east-1').fill('us-east-1');
    // Leave the credential fields blank: LlmProviderForm falls back to host AWS
    // credentials (the local .env Bedrock config) when they're empty.
    await page.getByRole('button', { name: 'Validate & Discover Models' }).click();

    const chatModelSelect = page.getByRole('combobox').filter({ hasText: 'Select chat model' });
    await expect(chatModelSelect).toBeVisible({ timeout: 30000 });
    await chatModelSelect.click();
    // Pick a specific current model rather than the first discovered entry: Bedrock's
    // discovery list includes deprecated/legacy profiles (e.g. "Claude 3 Sonnet") that
    // return an "Access denied... marked by provider as Legacy" error on invocation.
    await page.getByRole('option', { name: 'US Anthropic Claude Sonnet 4.6', exact: true }).click();

    const embeddingModelSelect = page.getByRole('combobox').filter({ hasText: 'Select embedding model' });
    await embeddingModelSelect.click();
    await page.getByRole('option').first().click();

    // Mark as default: the agent below keeps its create-dialog default model ID, which
    // won't match a discovered Bedrock model ID, so playground inference must resolve
    // the LLM config via the tenant's default provider rather than a model-ID lookup.
    await page.getByRole('switch', { name: 'Set as default provider' }).click();

    await page.getByRole('button', { name: 'Create Provider' }).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTES.agentLlmProviders}$`), { timeout: 15000 });
    await expect(page.getByText(providerName)).toBeVisible();

    await page.goto(ROUTES.agents);
    await page.getByRole('button', { name: 'New Agent' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill(agentName);
    // Type defaults to "simple" — matches the recorded session.
    await page.getByRole('button', { name: 'Create Agent' }).click();
    // Generous timeout: first hit of /api/agents can hit a Next.js dev-mode on-demand compile.
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15000 });

    await page.getByRole('row', { name: agentName }).getByLabel('Edit agent').click();
    await expect(page).toHaveURL(/\/agents\/.+\/edit$/, { timeout: 15000 });

    await page.getByRole('textbox', { name: 'System Prompt' }).fill('You are a helpful agent.');

    // The agent's Model field defaults to a hardcoded placeholder ID that Bedrock rejects
    // ("The provided model identifier is invalid.") — it must be set to the model chosen
    // for the provider above, scoped to that provider's option group in case other
    // providers (and their models) also exist for this tenant.
    await page.getByRole('combobox').click();
    // The search box opens pre-filled with the current (invalid) custom model ID, which
    // matches no discovered model and hides the option list — clear it first.
    await page.getByPlaceholder('Search or enter a model ID…').fill('');
    await page.getByRole('group', { name: providerName }).getByRole('option').first().click();

    await page.getByRole('button', { name: 'Save Configuration' }).click();
    await expect(page.getByText('Agent saved')).toBeVisible();

    await page.getByRole('button', { name: 'Open playground' }).click();
    await expect(page).toHaveURL(/\/agents\/.+\/playground$/, { timeout: 15000 });

    // The send button is icon-only with no accessible name — submit with Enter instead.
    await page.getByRole('textbox', { name: 'Type a message...' }).fill('hi');
    await page.getByRole('textbox', { name: 'Type a message...' }).press('Enter');
    // Real Bedrock round-trip — generous timeout for the live LLM call.
    await expect(page.locator('.prose').first()).toBeVisible({ timeout: 30000 });

    // Same Base UI Button(render={Link}) pattern as "Open playground" — exposed as a
    // button in the accessibility tree despite navigating like a link.
    await page.getByRole('button', { name: 'Back to agent' }).click();
    // "Back to agent" lands on the read-only /agents/[id] detail page, which only shows
    // a "Versions & Aliases" summary card — the actual Versions/API Keys tabs (and the
    // Publish action) live on /agents/[id]/edit, reached via "Edit Agent".
    await page.getByRole('button', { name: 'Edit Agent' }).click();
    await expect(page).toHaveURL(/\/agents\/.+\/edit$/, { timeout: 15000 });
    await page.getByRole('tab', { name: 'Versions' }).click();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published')).toBeVisible();

    await page.getByRole('tab', { name: 'API Keys' }).click();
    await page.getByRole('button', { name: 'Create API Key' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill(`${agentName}-key`);
    await page.getByRole('spinbutton', { name: 'Daily Requests' }).fill('1001');
    await page.getByRole('spinbutton', { name: 'Daily Tokens' }).fill('100001');
    await page.getByRole('spinbutton', { name: 'Per-Minute Requests' }).fill('101');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText("Your API Key (copy it now, it won't be shown again):")).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
  });
});

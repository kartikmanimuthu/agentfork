import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';
import { ensureSimpleAgentWithApiKey } from '../../helpers/agent-fixture';

test.describe('Agent built-in tools — simple agent Tools tab', { tag: [TAG.regression] }, () => {
  test('enabling Web Search persists after reload', async ({ page, request }) => {
    const { agentId } = await ensureSimpleAgentWithApiKey(request);
    await page.goto(`/agents/${agentId}/edit`);
    await page.getByRole('tab', { name: 'Tools' }).click();
    await page.getByLabel('Web Search').click();
    await page.getByRole('button', { name: 'Save Tools' }).click();
    await expect(page.getByText('Agent saved')).toBeVisible();

    await page.reload();
    await page.getByRole('tab', { name: 'Tools' }).click();
    await expect(page.getByLabel('Web Search')).toBeChecked();
  });

  test('enabling Web Search reveals the search provider sub-form', async ({ page, request }) => {
    const { agentId } = await ensureSimpleAgentWithApiKey(request);
    await page.goto(`/agents/${agentId}/edit`);
    await page.getByRole('tab', { name: 'Tools' }).click();

    await expect(page.getByText('Search Provider Configuration')).not.toBeVisible();
    await page.getByLabel('Web Search').click();
    await expect(page.getByText('Search Provider Configuration')).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveText('Tavily');

    await page.getByLabel('Web Search').click();
    await expect(page.getByText('Search Provider Configuration')).not.toBeVisible();
  });

  test('Web Fetch toggle persists independently of Web Search', async ({ page, request }) => {
    const { agentId } = await ensureSimpleAgentWithApiKey(request);
    await page.goto(`/agents/${agentId}/edit`);
    await page.getByRole('tab', { name: 'Tools' }).click();
    await page.getByLabel('Web Fetch').click();
    await page.getByRole('button', { name: 'Save Tools' }).click();
    await expect(page.getByText('Agent saved')).toBeVisible();

    await page.reload();
    await page.getByRole('tab', { name: 'Tools' }).click();
    await expect(page.getByLabel('Web Fetch')).toBeChecked();
    await expect(page.getByLabel('Web Search')).not.toBeChecked();
  });
});

test.describe('Agent built-in tools — graph agent tool node', { tag: [TAG.regression] }, () => {
  test('switching the Tool node from a built-in to Custom clears the built-in name', async ({ page, request }) => {
    const agentRes = await request.post('/api/agents', {
      data: {
        name: `e2e-graph-agent-${Date.now()}`,
        type: 'graph',
        config: {
          nodes: [
            {
              id: 'tool-1',
              type: 'tool',
              label: 'Web Search Tool',
              config: { type: 'tool', toolName: 'web_search' },
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
        },
      },
    });
    expect(agentRes.ok()).toBeTruthy();
    const agent = await agentRes.json();

    await page.goto(`/agents/${agent.id}/edit`);
    await page.getByText('Web Search Tool', { exact: true }).click();

    const toolSelect = page.locator('#tool-select');
    await expect(toolSelect).toHaveValue('web_search');

    await toolSelect.selectOption('__custom__');
    const customInput = page.getByPlaceholder('Enter MCP tool name');
    await expect(customInput).toBeVisible();
    await expect(customInput).toHaveValue('');

    await customInput.fill('my_custom_tool');
    await customInput.blur();

    // The canvas node card renders the live toolName from node config — confirms the
    // custom name round-tripped through onChange into the graph state, not just the form.
    await expect(page.getByText('my_custom_tool', { exact: true })).toBeVisible();
  });
});

import type { APIRequestContext } from '@playwright/test';

/**
 * Creates a simple agent, publishes a draft version, activates the agent,
 * and mints an API key — using the app's own session-authenticated routes
 * (the `request` fixture carries the chromium project's storageState cookie).
 *
 * Route shapes confirmed against real source, not assumed:
 * - POST /api/agents returns the raw agent row (status starts as 'draft').
 * - POST /api/agents/[id]/versions returns the raw agentVersion row (status 'draft').
 * - POST /api/agents/[id]/versions/[versionId]/publish flips that version to 'published'.
 * - PUT /api/agents/[id] with { status: 'active' } is required separately —
 *   publishing a version does NOT change the agent's own status.
 * - POST /api/agents/[id]/api-keys returns { rawKey, apiKey } — the raw secret
 *   is `rawKey`, NOT `apiKey.key` or `apiKey.token`.
 */
export async function ensureSimpleAgentWithApiKey(
  request: APIRequestContext,
): Promise<{ agentId: string; apiKey: string }> {
  const agentRes = await request.post('/api/agents', {
    data: { name: `e2e-agent-${Date.now()}`, type: 'simple', config: {} },
  });
  if (!agentRes.ok()) {
    throw new Error(`Failed to create agent: ${agentRes.status()} ${await agentRes.text()}`);
  }
  const agent = await agentRes.json();
  const agentId: string = agent.id;

  const versionRes = await request.post(`/api/agents/${agentId}/versions`, {
    data: {
      config: { systemPrompt: 'You are a helpful assistant.', temperature: 0.7, maxTokens: 256 },
    },
  });
  if (!versionRes.ok()) {
    throw new Error(`Failed to create agent version: ${versionRes.status()} ${await versionRes.text()}`);
  }
  const version = await versionRes.json();
  const versionId: string = version.id;

  const publishRes = await request.post(`/api/agents/${agentId}/versions/${versionId}/publish`);
  if (!publishRes.ok()) {
    throw new Error(`Failed to publish agent version: ${publishRes.status()} ${await publishRes.text()}`);
  }

  const activateRes = await request.put(`/api/agents/${agentId}`, {
    data: { status: 'active' },
  });
  if (!activateRes.ok()) {
    throw new Error(`Failed to activate agent: ${activateRes.status()} ${await activateRes.text()}`);
  }

  const keyRes = await request.post(`/api/agents/${agentId}/api-keys`, {
    data: { name: 'e2e-key' },
  });
  if (!keyRes.ok()) {
    throw new Error(`Failed to mint API key: ${keyRes.status()} ${await keyRes.text()}`);
  }
  const { rawKey } = await keyRes.json();

  return { agentId, apiKey: rawKey };
}

# MCP Graph Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-tool MCP Server node (deterministic batch) and MCP tool-calling support on the LLM node (agentic), in that order.

**Architecture:** Change 2 (multi-tool MCP node) is isolated to the MCP executor + a new API route + form UI. Change 1 (MCP on LLM) adds tool discovery/call logic to the LLM executor and a multi-select to the LLM node form. Both changes are additive — no existing behaviour is removed.

**Tech Stack:** TypeScript, Vitest (unit tests), Zod, `@tanstack/react-form`, `@tanstack/react-query`, `@xyflow/react`, `@chatbot/agent-studio`, Next.js 15 App Router API routes.

---

## PART A — Change 2: Multi-Tool MCP Server Node

---

### Task 1: Update `McpServerNodeConfig` type and Zod schema

**Files:**
- Modify: `libs/agent-studio/src/types/nodes.ts`
- Modify: `libs/agent-studio/src/registry/schemas/mcp-server.ts`

- [ ] **Step 1: Update the TypeScript interface**

In `libs/agent-studio/src/types/nodes.ts`, replace the `McpServerNodeConfig` interface (currently lines 90–99) with:

```typescript
export interface McpServerNodeConfig {
  type: 'mcp_server';
  serverId: string;
  serverName?: string;
  toolMode?: 'single' | 'selected' | 'all';
  toolName?: string;
  toolNames?: string[];
  argumentSource: 'from_state' | 'static';
  staticArguments?: Record<string, unknown>;
  channelMappings?: Record<string, string>;
  outputChannel: string;
}
```

`toolName` is now optional (was required). `toolMode` and `toolNames` are new optional fields.

- [ ] **Step 2: Update the Zod schema**

In `libs/agent-studio/src/registry/schemas/mcp-server.ts`, replace the full file content with:

```typescript
import { z } from 'zod';

export const mcpServerNodeSchema = z.object({
  type: z.literal('mcp_server'),
  serverId: z.string().min(1),
  serverName: z.string().optional(),
  toolMode: z.enum(['single', 'selected', 'all']).optional(),
  toolName: z.string().optional(),
  toolNames: z.array(z.string()).optional(),
  argumentSource: z.enum(['from_state', 'static']),
  staticArguments: z.record(z.string(), z.unknown()).optional(),
  channelMappings: z.record(z.string(), z.string()).optional(),
  outputChannel: z.string().min(1),
});
```

- [ ] **Step 3: Type-check to confirm no downstream breakage**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
bunx tsc --noEmit -p libs/agent-studio/tsconfig.json 2>&1 | head -30
```

Expected: no errors (or only pre-existing unrelated errors).

- [ ] **Step 4: Commit**

```bash
git add libs/agent-studio/src/types/nodes.ts libs/agent-studio/src/registry/schemas/mcp-server.ts
git commit -m "feat(agent-studio): extend McpServerNodeConfig with toolMode and toolNames"
```

---

### Task 2: Write failing tests for the multi-tool MCP executor

**Files:**
- Create: `libs/agent-studio/src/execution/node-executors/mcp-server-executor.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// libs/agent-studio/src/execution/node-executors/mcp-server-executor.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServerNodeExecutor } from './mcp-server-executor';
import { McpClientService } from '../../services/mcp-client.service';
import type { NodeExecutionContext, GraphState } from '../types';
import type { GraphNode } from '../../types/agent';

vi.mock('../../services/mcp-client.service');

const MOCK_SERVER = {
  id: 'server-id-1',
  name: 'test-server',
  status: 'active',
  config: { transport: 'sse', transportConfig: { transport: 'sse', endpoint: 'http://localhost:4000' } },
};

const TWO_TOOLS = [
  { name: 'tool_a', description: 'Tool A', inputSchema: { type: 'object', properties: {} } },
  { name: 'tool_b', description: 'Tool B', inputSchema: { type: 'object', properties: {} } },
];

function makeCtx(config: Record<string, unknown>, channels: Record<string, unknown> = {}): NodeExecutionContext {
  return {
    node: { id: 'node-1', type: 'mcp_server', label: 'MCP Node', config: config as any, position: { x: 0, y: 0 } } as GraphNode,
    config: config as any,
    state: {
      channels,
      messages: [],
      currentNodeId: 'node-1',
      metadata: { executionId: 'exec-1', agentId: 'agent-1', tenantId: 'tenant-1', userId: 'user-1', startedAt: new Date() },
    } as GraphState,
    services: {
      prisma: { mcpServer: { findFirst: vi.fn().mockResolvedValue(MOCK_SERVER) } },
      llmProvider: vi.fn(),
    },
    emit: vi.fn(),
  };
}

describe('McpServerNodeExecutor', () => {
  let executor: McpServerNodeExecutor;
  let mockConnect: ReturnType<typeof vi.fn>;
  let mockExecuteTool: ReturnType<typeof vi.fn>;
  let mockDiscoverTools: ReturnType<typeof vi.fn>;
  let mockDisconnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    executor = new McpServerNodeExecutor();
    mockConnect = vi.fn().mockResolvedValue(undefined);
    mockExecuteTool = vi.fn().mockResolvedValue('tool result');
    mockDiscoverTools = vi.fn().mockResolvedValue(TWO_TOOLS);
    mockDisconnect = vi.fn().mockResolvedValue(undefined);
    vi.mocked(McpClientService).mockImplementation(() => ({
      connect: mockConnect,
      executeTool: mockExecuteTool,
      discoverTools: mockDiscoverTools,
      disconnect: mockDisconnect,
    } as any));
  });

  afterEach(() => vi.clearAllMocks());

  // ── single mode ────────────────────────────────────────────────────────────

  describe('single mode', () => {
    it('calls the specified tool with static args and writes string to outputChannel', async () => {
      const ctx = makeCtx({
        type: 'mcp_server', serverId: 'server-id-1',
        toolMode: 'single', toolName: 'get_price',
        argumentSource: 'static', staticArguments: { symbol: 'AAPL' },
        outputChannel: 'price_result',
      });

      const result = await executor.execute(ctx);

      expect(mockExecuteTool).toHaveBeenCalledWith('get_price', { symbol: 'AAPL' });
      expect(result.stateUpdates).toEqual({ price_result: 'tool result' });
      expect(result.trace.status).toBe('completed');
    });

    it('defaults to single mode when toolMode is absent (backward compat)', async () => {
      const ctx = makeCtx({
        type: 'mcp_server', serverId: 'server-id-1',
        toolName: 'get_price',
        argumentSource: 'static', staticArguments: {},
        outputChannel: 'result',
      });

      const result = await executor.execute(ctx);

      expect(mockExecuteTool).toHaveBeenCalledTimes(1);
      expect(result.trace.status).toBe('completed');
    });

    it('maps channel values to args via channelMappings in from_state mode', async () => {
      const ctx = makeCtx(
        {
          type: 'mcp_server', serverId: 'server-id-1',
          toolMode: 'single', toolName: 'search',
          argumentSource: 'from_state', channelMappings: { query: 'user_query' },
          outputChannel: 'search_result',
        },
        { user_query: 'hello world' },
      );

      await executor.execute(ctx);

      expect(mockExecuteTool).toHaveBeenCalledWith('search', { query: 'hello world' });
    });

    it('returns failed trace when toolName is missing in single mode', async () => {
      const ctx = makeCtx({
        type: 'mcp_server', serverId: 'server-id-1',
        toolMode: 'single',
        argumentSource: 'static', staticArguments: {},
        outputChannel: 'result',
      });

      const result = await executor.execute(ctx);

      expect(result.trace.status).toBe('failed');
      expect(result.trace.error).toContain('toolName is required');
    });
  });

  // ── selected mode ──────────────────────────────────────────────────────────

  describe('selected mode', () => {
    it('calls each tool in toolNames and writes JSON object to outputChannel', async () => {
      mockExecuteTool
        .mockResolvedValueOnce('result_a')
        .mockResolvedValueOnce('result_b');

      const ctx = makeCtx({
        type: 'mcp_server', serverId: 'server-id-1',
        toolMode: 'selected', toolNames: ['tool_a', 'tool_b'],
        argumentSource: 'static', staticArguments: {},
        outputChannel: 'combined',
      });

      const result = await executor.execute(ctx);

      expect(mockExecuteTool).toHaveBeenCalledTimes(2);
      expect(mockExecuteTool).toHaveBeenCalledWith('tool_a', {});
      expect(mockExecuteTool).toHaveBeenCalledWith('tool_b', {});
      const parsed = JSON.parse(result.stateUpdates['combined'] as string);
      expect(parsed).toEqual({ tool_a: 'result_a', tool_b: 'result_b' });
      expect(result.trace.status).toBe('completed');
    });

    it('passes same args to all selected tools', async () => {
      const ctx = makeCtx({
        type: 'mcp_server', serverId: 'server-id-1',
        toolMode: 'selected', toolNames: ['tool_a', 'tool_b'],
        argumentSource: 'static', staticArguments: { key: 'val' },
        outputChannel: 'result',
      });

      await executor.execute(ctx);

      expect(mockExecuteTool).toHaveBeenNthCalledWith(1, 'tool_a', { key: 'val' });
      expect(mockExecuteTool).toHaveBeenNthCalledWith(2, 'tool_b', { key: 'val' });
    });

    it('returns failed trace when toolNames is empty', async () => {
      const ctx = makeCtx({
        type: 'mcp_server', serverId: 'server-id-1',
        toolMode: 'selected', toolNames: [],
        argumentSource: 'static', staticArguments: {},
        outputChannel: 'result',
      });

      const result = await executor.execute(ctx);

      expect(result.trace.status).toBe('failed');
      expect(result.stateUpdates['result']).toBeNull();
    });
  });

  // ── all mode ───────────────────────────────────────────────────────────────

  describe('all mode', () => {
    it('discovers tools, calls all, writes JSON object to outputChannel', async () => {
      mockExecuteTool
        .mockResolvedValueOnce('result_a')
        .mockResolvedValueOnce('result_b');

      const ctx = makeCtx({
        type: 'mcp_server', serverId: 'server-id-1',
        toolMode: 'all',
        argumentSource: 'static', staticArguments: {},
        outputChannel: 'all_results',
      });

      const result = await executor.execute(ctx);

      expect(mockDiscoverTools).toHaveBeenCalledOnce();
      expect(mockExecuteTool).toHaveBeenCalledTimes(2);
      const parsed = JSON.parse(result.stateUpdates['all_results'] as string);
      expect(parsed).toEqual({ tool_a: 'result_a', tool_b: 'result_b' });
      expect(result.trace.status).toBe('completed');
    });

    it('returns failed trace when server exposes more than 20 tools', async () => {
      mockDiscoverTools.mockResolvedValue(
        Array.from({ length: 21 }, (_, i) => ({
          name: `tool_${i}`, description: '', inputSchema: { type: 'object', properties: {} },
        })),
      );

      const ctx = makeCtx({
        type: 'mcp_server', serverId: 'server-id-1',
        toolMode: 'all',
        argumentSource: 'static', staticArguments: {},
        outputChannel: 'result',
      });

      const result = await executor.execute(ctx);

      expect(result.trace.status).toBe('failed');
      expect(result.trace.error).toContain('capped at 20');
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });
  });

  // ── shared error handling ──────────────────────────────────────────────────

  it('disconnects MCP client in finally block even when executeTool throws', async () => {
    mockExecuteTool.mockRejectedValue(new Error('tool error'));

    const ctx = makeCtx({
      type: 'mcp_server', serverId: 'server-id-1',
      toolMode: 'single', toolName: 'failing_tool',
      argumentSource: 'static', staticArguments: {},
      outputChannel: 'result',
    });

    const result = await executor.execute(ctx);

    expect(mockDisconnect).toHaveBeenCalledOnce();
    expect(result.trace.status).toBe('failed');
  });

  it('returns failed trace when server is not found', async () => {
    const ctx = makeCtx({
      type: 'mcp_server', serverId: 'unknown',
      toolMode: 'single', toolName: 'some_tool',
      argumentSource: 'static', staticArguments: {},
      outputChannel: 'result',
    });
    (ctx.services.prisma.mcpServer as any).findFirst.mockResolvedValue(null);

    const result = await executor.execute(ctx);

    expect(result.trace.status).toBe('failed');
    expect(result.trace.error).toContain('not found');
  });

  it('returns failed trace when server status is not active', async () => {
    const ctx = makeCtx({
      type: 'mcp_server', serverId: 'server-id-1',
      toolMode: 'single', toolName: 'some_tool',
      argumentSource: 'static', staticArguments: {},
      outputChannel: 'result',
    });
    (ctx.services.prisma.mcpServer as any).findFirst.mockResolvedValue({ ...MOCK_SERVER, status: 'inactive' });

    const result = await executor.execute(ctx);

    expect(result.trace.status).toBe('failed');
    expect(result.trace.error).toContain('not active');
  });
});
```

- [ ] **Step 2: Run and confirm all tests fail (executor not yet updated)**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
bunx vitest run libs/agent-studio/src/execution/node-executors/mcp-server-executor.test.ts 2>&1 | tail -20
```

Expected: multiple failures — tests for `selected`, `all`, and `toolMode` modes will fail because the executor still only handles `single` mode with `toolName` required.

---

### Task 3: Implement the multi-tool MCP executor

**Files:**
- Modify: `libs/agent-studio/src/execution/node-executors/mcp-server-executor.ts`

- [ ] **Step 1: Replace the executor with the multi-mode implementation**

```typescript
// libs/agent-studio/src/execution/node-executors/mcp-server-executor.ts
import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { McpServerNodeConfig } from '../../types/nodes';
import { McpClientService } from '../../services/mcp-client.service';
import type { McpServerConfig } from '../../types/mcp-server';

const logger = createLogger('agent-studio:mcp-server-executor');

const MAX_ALL_MODE_TOOLS = 20;

export class McpServerNodeExecutor implements NodeExecutor {
  type = 'mcp_server';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as McpServerNodeConfig;
    const startedAt = new Date().toISOString();
    const toolMode = config.toolMode ?? 'single';

    const args: Record<string, unknown> = {};
    if (config.argumentSource === 'static') {
      Object.assign(args, config.staticArguments ?? {});
    } else if (config.channelMappings) {
      for (const [param, channel] of Object.entries(config.channelMappings)) {
        args[param] = ctx.state.channels[channel] ?? null;
      }
    }

    const mcpClient = new McpClientService();

    try {
      const server = await ctx.services.prisma.mcpServer.findFirst({
        where: { OR: [{ id: config.serverId }, { name: config.serverId }] },
      });

      if (!server) throw new Error(`MCP server not found: ${config.serverId}`);
      if (server.status !== 'active') {
        throw new Error(`MCP server "${server.name}" is not active (status: ${server.status})`);
      }

      const serverConfig = server.config as McpServerConfig;
      await mcpClient.connect(serverConfig);

      let stateValue: string;

      if (toolMode === 'single') {
        if (!config.toolName) throw new Error('toolName is required in single mode');
        const result = await mcpClient.executeTool(config.toolName, args);
        stateValue = String(result);
        logger.info(
          { nodeId: ctx.node.id, serverId: config.serverId, toolName: config.toolName },
          'MCP tool executed successfully',
        );
      } else if (toolMode === 'selected') {
        const toolNames = config.toolNames ?? [];
        if (toolNames.length === 0) throw new Error('toolNames must not be empty in selected mode');
        const results: Record<string, unknown> = {};
        for (const toolName of toolNames) {
          results[toolName] = await mcpClient.executeTool(toolName, args);
          logger.info(
            { nodeId: ctx.node.id, serverId: config.serverId, toolName },
            'MCP tool executed successfully',
          );
        }
        stateValue = JSON.stringify(results);
      } else {
        // all mode
        const discovered = await mcpClient.discoverTools(serverConfig);
        if (discovered.length > MAX_ALL_MODE_TOOLS) {
          throw new Error(
            `MCP server "${server.name}" exposes ${discovered.length} tools but 'all' mode is capped at ${MAX_ALL_MODE_TOOLS}. Use 'selected' mode to pick specific tools.`,
          );
        }
        const results: Record<string, unknown> = {};
        for (const tool of discovered) {
          results[tool.name] = await mcpClient.executeTool(tool.name, args);
          logger.info(
            { nodeId: ctx.node.id, serverId: config.serverId, toolName: tool.name },
            'MCP tool executed successfully',
          );
        }
        stateValue = JSON.stringify(results);
      }

      return {
        stateUpdates: { [config.outputChannel]: stateValue },
        next: null,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'mcp_server',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { serverId: config.serverId, toolMode, arguments: args },
          output: { outputChannel: config.outputChannel } as Record<string, unknown>,
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(
        { nodeId: ctx.node.id, serverId: config.serverId, toolMode, err },
        'MCP tool execution failed',
      );
      return {
        stateUpdates: { [config.outputChannel]: null },
        next: null,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'mcp_server',
          nodeLabel: ctx.node.label,
          status: 'failed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { serverId: config.serverId, toolMode, arguments: args },
          output: undefined,
          error: errorMessage,
        },
      };
    } finally {
      await mcpClient.disconnect();
    }
  }
}
```

- [ ] **Step 2: Run tests and confirm all pass**

```bash
bunx vitest run libs/agent-studio/src/execution/node-executors/mcp-server-executor.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 3: Run the full test suite to check for regressions**

```bash
bunx vitest run libs/agent-studio 2>&1 | tail -30
```

Expected: all previously passing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add libs/agent-studio/src/execution/node-executors/mcp-server-executor.ts \
        libs/agent-studio/src/execution/node-executors/mcp-server-executor.test.ts
git commit -m "feat(agent-studio): add multi-tool support to MCP Server node executor"
```

---

### Task 4: New API route — `GET /api/mcp-servers/[id]/tools`

**Files:**
- Create: `apps/web-ui/app/api/mcp-servers/[id]/tools/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
// apps/web-ui/app/api/mcp-servers/[id]/tools/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:mcp-servers[id]:tools');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'McpServers', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const db = getPrismaClient();

    const server = await db.mcpServer.findFirst({ where: { id, tenantId } });
    if (!server) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (server.status !== 'active') {
      logger.info({ tenantId, mcpServerId: id, status: server.status }, 'Server not active — returning empty tool list');
      return NextResponse.json({ tools: [], error: 'Server is inactive' });
    }

    const { McpClientService } = await import('@chatbot/agent-studio/server');
    const mcpClient = new McpClientService();

    try {
      const discovered = await mcpClient.discoverTools(server.config as any);
      logger.info({ tenantId, mcpServerId: id, toolCount: discovered.length }, 'Tools discovered');
      return NextResponse.json({
        tools: discovered.map((t) => ({ name: t.name, description: t.description })),
      });
    } catch (connErr) {
      logger.warn({ tenantId, mcpServerId: id, err: connErr }, 'Failed to connect to MCP server for tool discovery');
      return NextResponse.json({ tools: [], error: 'Could not connect to server' });
    } finally {
      await mcpClient.disconnect().catch(() => {});
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const { id } = await params;
    logger.error({ error, mcpServerId: id }, 'MCP tools discovery route failed');
    return NextResponse.json({ tools: [], error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Type-check the new route**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | grep "tools/route"
```

Expected: no output (no errors in that file).

- [ ] **Step 3: Verify the route is reachable (dev server must be running)**

```bash
curl -s http://localhost:3005/api/mcp-servers/nonexistent-id/tools \
  -H "Cookie: $(cat /tmp/dev-session-cookie 2>/dev/null || echo '')" | head -5
```

Expected: JSON response (either 401 unauthenticated or 404 not found — both confirm the route exists).

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/app/api/mcp-servers/[id]/tools/route.ts
git commit -m "feat(api): add GET /api/mcp-servers/:id/tools endpoint for tool discovery"
```

---

### Task 5: New hook — `useMcpServerTools`

**Files:**
- Create: `apps/web-ui/hooks/use-mcp-server-tools.ts`

- [ ] **Step 1: Create the hook file**

```typescript
// apps/web-ui/hooks/use-mcp-server-tools.ts
import { useQuery } from '@tanstack/react-query';

export interface McpDiscoveredTool {
  name: string;
  description: string;
}

export interface McpServerToolsResult {
  tools: McpDiscoveredTool[];
  error?: string;
}

async function fetchMcpServerTools(serverId: string): Promise<McpServerToolsResult> {
  const res = await fetch(`/api/mcp-servers/${serverId}/tools`);
  if (!res.ok) throw new Error('Failed to fetch MCP server tools');
  return res.json();
}

export const mcpServerToolKeys = {
  tools: (serverId: string) => ['mcp-servers', serverId, 'tools'] as const,
};

export function useMcpServerTools(serverId: string) {
  return useQuery({
    queryKey: mcpServerToolKeys.tools(serverId),
    queryFn: () => fetchMcpServerTools(serverId),
    enabled: Boolean(serverId),
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | grep "use-mcp-server-tools"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/hooks/use-mcp-server-tools.ts
git commit -m "feat(web-ui): add useMcpServerTools hook"
```

---

### Task 6: Update the MCP Server node form

**Files:**
- Modify: `apps/web-ui/components/agents/config/mcp-server-node-form.tsx`

- [ ] **Step 1: Replace the file with the full multi-mode form**

```typescript
// apps/web-ui/components/agents/config/mcp-server-node-form.tsx
'use client';

import { useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { McpServerNodeConfig } from '@chatbot/agent-studio';
import { useMcpServers } from '@/hooks/use-mcp-servers';
import { useMcpServerTools } from '@/hooks/use-mcp-server-tools';

const schema = z.object({
  serverId: z.string().min(1, 'Server is required'),
  toolMode: z.enum(['single', 'selected', 'all']),
  toolName: z.string().optional(),
  toolNames: z.array(z.string()).optional(),
  argumentSource: z.enum(['from_state', 'static']),
  staticArguments: z.string().optional(),
  channelMappings: z.string().optional(),
  outputChannel: z.string().min(1, 'Output channel is required'),
});

type McpFormValues = z.infer<typeof schema>;

interface McpServerNodeFormProps {
  config: McpServerNodeConfig;
  onChange: (config: McpServerNodeConfig) => void;
}

export function McpServerNodeForm({ config, onChange }: McpServerNodeFormProps) {
  const { data: mcpData, isLoading: mcpLoading } = useMcpServers({ pageSize: 100 });
  const servers = mcpData?.items ?? [];

  const serverNameRef = useRef<string>(config.serverName ?? '');
  // Track current serverId as state so useMcpServerTools re-fetches on change
  const [currentServerId, setCurrentServerId] = useState(config.serverId ?? '');

  const { data: toolsData, isLoading: toolsLoading } = useMcpServerTools(currentServerId);
  const availableTools = toolsData?.tools ?? [];
  const toolsError = toolsData?.error;

  const form = useForm({
    defaultValues: {
      serverId: config.serverId ?? '',
      toolMode: config.toolMode ?? 'single',
      toolName: config.toolName ?? '',
      toolNames: config.toolNames ?? [],
      argumentSource: config.argumentSource ?? 'from_state',
      staticArguments: config.staticArguments ? JSON.stringify(config.staticArguments, null, 2) : '',
      channelMappings: config.channelMappings ? JSON.stringify(config.channelMappings, null, 2) : '',
      outputChannel: config.outputChannel ?? 'mcp_result',
    } as McpFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      let staticArgs: Record<string, unknown> | undefined;
      if (value.argumentSource === 'static' && value.staticArguments) {
        try { staticArgs = JSON.parse(value.staticArguments); } catch { staticArgs = undefined; }
      }
      let mappings: Record<string, string> | undefined;
      if (value.argumentSource === 'from_state' && value.channelMappings) {
        try { mappings = JSON.parse(value.channelMappings); } catch { mappings = undefined; }
      }

      const base: Omit<McpServerNodeConfig, 'toolName' | 'toolNames'> = {
        type: 'mcp_server',
        serverId: value.serverId,
        serverName: serverNameRef.current || undefined,
        toolMode: value.toolMode,
        argumentSource: value.argumentSource,
        staticArguments: staticArgs,
        channelMappings: mappings,
        outputChannel: value.outputChannel,
      };

      if (value.toolMode === 'single') {
        onChange({ ...base, toolName: value.toolName || undefined });
      } else if (value.toolMode === 'selected') {
        onChange({ ...base, toolNames: (value.toolNames ?? []).filter(Boolean) });
      } else {
        onChange(base); // all mode — no tool selection stored
      }
    },
  });

  const handleBlur = () => form.handleSubmit();

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}
      className="space-y-4"
    >
      {/* Server selection */}
      <form.Field name="serverId">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>MCP Server</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                const server = servers.find((s) => s.id === v);
                serverNameRef.current = server?.name ?? '';
                setCurrentServerId(v);
                field.handleChange(v);
                handleBlur();
              }}
              disabled={mcpLoading}
            >
              <SelectTrigger id={field.name} aria-label="MCP Server">
                <SelectValue placeholder={mcpLoading ? 'Loading...' : 'Select a server'} />
              </SelectTrigger>
              <SelectContent>
                {servers.length === 0 && !mcpLoading && (
                  <SelectItem value="__empty__" disabled>No servers configured</SelectItem>
                )}
                {servers.map((server) => (
                  <SelectItem key={server.id} value={server.id}>
                    {server.name}
                    {server.status !== 'active' && (
                      <span className="ml-1 text-xs text-muted-foreground">({server.status})</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      {/* Tool mode selector */}
      <form.Field name="toolMode">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Tool Mode</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                field.handleChange(v as McpFormValues['toolMode']);
                handleBlur();
              }}
            >
              <SelectTrigger aria-label="Tool mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single — call one specific tool</SelectItem>
                <SelectItem value="selected">Selected — call chosen tools</SelectItem>
                <SelectItem value="all">All — call every tool on the server</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      {/* Tool selection — conditional on toolMode */}
      <form.Field name="toolMode">
        {(modeField) => {
          const mode = modeField.state.value;

          if (mode === 'single') {
            return (
              <form.Field name="toolName">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor={field.name}>Tool Name</Label>
                    {currentServerId && !toolsError ? (
                      <Select
                        value={field.state.value ?? ''}
                        onValueChange={(v) => { field.handleChange(v); handleBlur(); }}
                        disabled={toolsLoading || !currentServerId}
                      >
                        <SelectTrigger id={field.name} aria-label="Tool name">
                          <SelectValue placeholder={toolsLoading ? 'Loading tools...' : 'Select a tool'} />
                        </SelectTrigger>
                        <SelectContent>
                          {availableTools.length === 0 && !toolsLoading && (
                            <SelectItem value="__empty__" disabled>No tools found</SelectItem>
                          )}
                          {availableTools.map((t) => (
                            <SelectItem key={t.name} value={t.name} title={t.description}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={field.name}
                        value={field.state.value ?? ''}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={() => { field.handleBlur(); handleBlur(); }}
                        placeholder="tool_name"
                      />
                    )}
                    {toolsError && currentServerId && (
                      <p className="text-xs text-muted-foreground">Could not load tools — enter tool name manually.</p>
                    )}
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                    )}
                  </div>
                )}
              </form.Field>
            );
          }

          if (mode === 'selected') {
            return (
              <form.Field name="toolNames">
                {(field) => {
                  const selected = (field.state.value ?? []) as string[];
                  const toggle = (name: string) => {
                    const next = selected.includes(name)
                      ? selected.filter((n) => n !== name)
                      : [...selected, name];
                    form.setFieldValue('toolNames', next);
                    setTimeout(handleBlur, 0);
                  };
                  return (
                    <div className="grid gap-1.5">
                      <Label>Tools to Call</Label>
                      {!currentServerId && (
                        <p className="text-xs text-muted-foreground">Select a server first.</p>
                      )}
                      {currentServerId && toolsLoading && (
                        <p className="text-xs text-muted-foreground">Loading tools...</p>
                      )}
                      {currentServerId && toolsError && (
                        <p className="text-xs text-muted-foreground">Could not load tools from server.</p>
                      )}
                      {currentServerId && !toolsLoading && !toolsError && availableTools.length === 0 && (
                        <p className="text-xs text-muted-foreground">No tools found on this server.</p>
                      )}
                      {availableTools.map((t) => (
                        <div key={t.name} className="flex items-center gap-2">
                          <Checkbox
                            id={`tool-${t.name}`}
                            checked={selected.includes(t.name)}
                            onCheckedChange={() => toggle(t.name)}
                          />
                          <label
                            htmlFor={`tool-${t.name}`}
                            className="text-sm cursor-pointer"
                            title={t.description}
                          >
                            {t.name}
                          </label>
                        </div>
                      ))}
                      {selected.length === 0 && availableTools.length > 0 && (
                        <p className="text-xs text-destructive">Select at least one tool.</p>
                      )}
                    </div>
                  );
                }}
              </form.Field>
            );
          }

          // all mode
          return (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                All tools from this server will be called every time this node fires. Best for servers with few tools (max 20).
              </p>
            </div>
          );
        }}
      </form.Field>

      {/* Argument source */}
      <form.Field name="argumentSource">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Argument Source</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                field.handleChange(v as McpFormValues['argumentSource']);
                handleBlur();
              }}
            >
              <SelectTrigger aria-label="Argument source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="from_state">From State Channels</SelectItem>
                <SelectItem value="static">Static Arguments</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <form.Field name="argumentSource">
        {(argField) =>
          argField.state.value === 'static' ? (
            <form.Field name="staticArguments">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Static Arguments (JSON)</Label>
                  <Textarea
                    id={field.name}
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={() => { field.handleBlur(); handleBlur(); }}
                    placeholder='{"key": "value"}'
                    rows={4}
                    className="font-mono text-xs"
                  />
                </div>
              )}
            </form.Field>
          ) : (
            <form.Field name="channelMappings">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Channel Mappings (JSON)</Label>
                  <Textarea
                    id={field.name}
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={() => { field.handleBlur(); handleBlur(); }}
                    placeholder='{"param": "channel_name"}'
                    rows={4}
                    className="font-mono text-xs"
                  />
                </div>
              )}
            </form.Field>
          )
        }
      </form.Field>

      <form.Field name="outputChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Output Channel</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="mcp_result"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>
    </form>
  );
}
```

- [ ] **Step 2: Check that shadcn `Checkbox` component is available**

```bash
ls apps/web-ui/components/ui/checkbox.tsx 2>/dev/null && echo "EXISTS" || echo "MISSING"
```

If MISSING, install it:
```bash
cd apps/web-ui && bunx shadcn@latest add checkbox --yes
```

- [ ] **Step 3: Type-check the updated form**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | grep "mcp-server-node-form"
```

Expected: no output.

- [ ] **Step 4: Manual test in the browser**

With dev server running at `http://localhost:3005`:
1. Open an agent → Graph tab → drag in an MCP Server node → open its config panel
2. Confirm server dropdown works (shows your MCP servers)
3. Change Tool Mode to "Single" → confirm tool dropdown appears and loads tools from the selected server
4. Change Tool Mode to "Selected" → confirm checkboxes appear
5. Change Tool Mode to "All" → confirm amber warning message appears
6. Save the graph and reload — confirm config persists correctly

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/components/agents/config/mcp-server-node-form.tsx
git commit -m "feat(web-ui): add multi-tool mode selector to MCP Server node form"
```

---

## PART B — Change 1: MCP Tools on the LLM Node

---

### Task 7: Update `LlmNodeConfig` type

**Files:**
- Modify: `libs/agent-studio/src/types/nodes.ts`

- [ ] **Step 1: Replace `tools?: string[]` with `mcpServerIds?: string[]` in `LlmNodeConfig`**

In `libs/agent-studio/src/types/nodes.ts`, find the `LlmNodeConfig` interface (currently lines 21–31) and replace it with:

```typescript
export interface LlmNodeConfig {
  type: 'llm';
  model: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** DB IDs of MCP servers whose tools this LLM node can call dynamically */
  mcpServerIds?: string[];
  /** Channel names whose string values are injected as RAG context into the last user message */
  contextChannels?: string[];
}
```

The previously defined but never-used `tools?: string[]` field is removed.

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit -p libs/agent-studio/tsconfig.json 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add libs/agent-studio/src/types/nodes.ts
git commit -m "feat(agent-studio): replace unused tools field with mcpServerIds on LlmNodeConfig"
```

---

### Task 8: Write failing tests for LLM executor MCP support

**Files:**
- Modify: `libs/agent-studio/src/execution/node-executors/node-executors.test.ts`

- [ ] **Step 1: Add module-level mock and import at the top of `node-executors.test.ts`**

Add these two lines to `node-executors.test.ts` — the import alongside the existing imports at the top, and `vi.mock` immediately after all imports (before the first helper function):

```typescript
// add to imports section
import { McpClientService } from '../../services/mcp-client.service';

// add after all imports, before createMockState helper
vi.mock('../../services/mcp-client.service');
```

`vi.mock` is hoisted by Vitest to before any imports at runtime, so its position in the file only matters for readability. The mock applies to all tests in the file — existing tests are unaffected because they never instantiate `McpClientService`.

- [ ] **Step 2: Add the MCP tool describe block at the end of `node-executors.test.ts`**

Append after the last closing brace of the file:

```typescript
describe('LlmNodeExecutor — MCP tool integration', () => {
  const executor = new LlmNodeExecutor();

  function makeStreamProvider(chunks: string[]) {
    return {
      streamChat: vi.fn().mockReturnValue({
        textStream: (async function* () { for (const c of chunks) yield c; })(),
      }),
    };
  }

  afterEach(() => vi.clearAllMocks());

  it('passes no tools to streamChat when mcpServerIds is absent', async () => {
    const mockProvider = makeStreamProvider(['response']);
    const ctx = createMockContext({
      state: createMockState({ messages: [{ role: 'user', content: 'Hi' }] }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3' },
      services: { llmProvider: vi.fn().mockResolvedValue(mockProvider), prisma: {} },
      emit: vi.fn(),
    });

    await executor.execute(ctx);

    expect(mockProvider.streamChat).toHaveBeenCalledWith(
      expect.not.objectContaining({ tools: expect.anything() }),
    );
  });

  it('discovers tools from MCP servers and passes them to streamChat', async () => {
    const mockProvider = makeStreamProvider(['response with tool']);
    const mockMcpInstance = {
      connect: vi.fn().mockResolvedValue(undefined),
      discoverTools: vi.fn().mockResolvedValue([
        { name: 'get_price', description: 'Get stock price', inputSchema: { type: 'object', properties: { symbol: { type: 'string' } } } },
      ]),
      executeTool: vi.fn().mockResolvedValue('$150'),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(McpClientService).mockImplementation(() => mockMcpInstance as any);

    const ctx = createMockContext({
      state: createMockState({ messages: [{ role: 'user', content: 'What is AAPL price?' }] }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3', mcpServerIds: ['server-id-1'] },
      services: {
        llmProvider: vi.fn().mockResolvedValue(mockProvider),
        prisma: {
          mcpServer: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'server-id-1', name: 'test-server', status: 'active',
              config: { transport: 'sse', transportConfig: { transport: 'sse', endpoint: 'http://localhost:4000' } },
            }),
          },
        },
      },
      emit: vi.fn(),
    });

    await executor.execute(ctx);

    expect(mockProvider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ tools: expect.any(Object), maxSteps: 10 }),
    );
    const callArgs = mockProvider.streamChat.mock.calls[0][0];
    expect(Object.keys(callArgs.tools)).toContain('test-server__get_price');
  });

  it('skips inactive MCP server and proceeds without tools', async () => {
    const mockProvider = makeStreamProvider(['response']);
    const ctx = createMockContext({
      state: createMockState({ messages: [{ role: 'user', content: 'Hi' }] }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3', mcpServerIds: ['server-id-1'] },
      services: {
        llmProvider: vi.fn().mockResolvedValue(mockProvider),
        prisma: {
          mcpServer: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'server-id-1', name: 'test-server', status: 'inactive', config: {},
            }),
          },
        },
      },
      emit: vi.fn(),
    });

    const result = await executor.execute(ctx);

    expect(mockProvider.streamChat).toHaveBeenCalledWith(
      expect.not.objectContaining({ tools: expect.anything() }),
    );
    expect(result.trace.status).toBe('completed');
  });

  it('skips unreachable MCP server and proceeds without tools', async () => {
    const mockProvider = makeStreamProvider(['response']);
    vi.mocked(McpClientService).mockImplementation(() => ({
      connect: vi.fn().mockRejectedValue(new Error('connection refused')),
      discoverTools: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as any));

    const ctx = createMockContext({
      state: createMockState({ messages: [{ role: 'user', content: 'Hi' }] }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3', mcpServerIds: ['server-id-1'] },
      services: {
        llmProvider: vi.fn().mockResolvedValue(mockProvider),
        prisma: {
          mcpServer: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'server-id-1', name: 'test-server', status: 'active',
              config: { transport: 'sse', transportConfig: { transport: 'sse', endpoint: 'http://bad' } },
            }),
          },
        },
      },
      emit: vi.fn(),
    });

    const result = await executor.execute(ctx);

    expect(mockProvider.streamChat).toHaveBeenCalledWith(
      expect.not.objectContaining({ tools: expect.anything() }),
    );
    expect(result.trace.status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run and confirm LLM MCP tests fail**

```bash
bunx vitest run libs/agent-studio/src/execution/node-executors/node-executors.test.ts \
  --reporter=verbose 2>&1 | grep -A 3 "MCP tool integration"
```

Expected: the new describe block fails — LLM executor doesn't yet support `mcpServerIds`.

---

### Task 9: Implement MCP tool support in the LLM executor

**Files:**
- Modify: `libs/agent-studio/src/execution/node-executors/llm-executor.ts`

- [ ] **Step 1: Replace the executor with MCP tool support**

```typescript
// libs/agent-studio/src/execution/node-executors/llm-executor.ts
import { jsonSchema } from 'ai';
import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { LlmNodeConfig } from '../../types/nodes';
import { McpClientService } from '../../services/mcp-client.service';
import type { McpServerConfig } from '../../types/mcp-server';

const logger = createLogger('agent-studio:llm-executor');

export class LlmNodeExecutor implements NodeExecutor {
  type = 'llm';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as LlmNodeConfig;
    const startedAt = new Date().toISOString();
    const mcpClients: McpClientService[] = [];

    try {
      const provider = await ctx.services.llmProvider(undefined, config.model);

      let messages = ctx.state.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const contextChannels = config.contextChannels ?? [];
      const channelContents = contextChannels
        .map((ch) => ({ ch, content: ctx.state.channels[ch] }))
        .filter(
          (e): e is { ch: string; content: string } =>
            typeof e.content === 'string' && e.content.trim().length > 0,
        );

      if (channelContents.length > 0) {
        const lastUserIdx = messages.reduce<number>(
          (found, m, i) => (m.role === 'user' ? i : found),
          -1,
        );

        if (lastUserIdx !== -1) {
          const docBlock = channelContents
            .map((e, i) => `<document index="${i + 1}">\n${e.content}\n</document>`)
            .join('\n');
          const xmlBlock = `<documents>\n${docBlock}\n</documents>`;

          messages = [
            ...messages.slice(0, lastUserIdx),
            { ...messages[lastUserIdx], content: `${xmlBlock}\n\n${messages[lastUserIdx].content}` },
            ...messages.slice(lastUserIdx + 1),
          ];

          logger.debug(
            { nodeId: ctx.node.id, channels: contextChannels, docCount: channelContents.length },
            'injected context channels into last user message',
          );
        } else {
          logger.warn(
            { nodeId: ctx.node.id, channels: contextChannels },
            'contextChannels configured but no user message found to inject into — skipping',
          );
        }
      }

      // ── MCP tool setup ──────────────────────────────────────────────────────
      const tools: Record<string, unknown> = {};

      if (config.mcpServerIds?.length) {
        const tenantId = ctx.state.metadata.tenantId;

        for (const serverId of config.mcpServerIds) {
          const server = await ctx.services.prisma.mcpServer.findFirst({
            where: { id: serverId, tenantId },
          });

          if (!server) {
            logger.warn({ nodeId: ctx.node.id, serverId }, 'MCP server not found — skipping');
            continue;
          }

          if (server.status !== 'active') {
            logger.warn(
              { nodeId: ctx.node.id, serverId, status: server.status },
              'MCP server not active — skipping',
            );
            continue;
          }

          const mcpClient = new McpClientService();
          try {
            const serverConfig = server.config as McpServerConfig;
            const discovered = await mcpClient.discoverTools(serverConfig);
            mcpClients.push(mcpClient);

            for (const tool of discovered) {
              const namespaced = `${server.name}__${tool.name}`;
              const capturedClient = mcpClient;
              const capturedToolName = tool.name;
              tools[namespaced] = {
                description: `[${server.name}] ${tool.description}`,
                inputSchema: jsonSchema({ ...tool.inputSchema, type: 'object' } as any),
                execute: async (args: Record<string, unknown>) =>
                  capturedClient.executeTool(capturedToolName, args),
              };
            }

            logger.info(
              { nodeId: ctx.node.id, serverId, serverName: server.name, toolCount: discovered.length },
              'MCP tools discovered for LLM node',
            );
          } catch (err) {
            logger.warn(
              { nodeId: ctx.node.id, serverId, err },
              'Failed to connect to MCP server — skipping',
            );
            await mcpClient.disconnect().catch(() => {});
          }
        }
      }

      const hasMcpTools = Object.keys(tools).length > 0;
      // ── End MCP tool setup ──────────────────────────────────────────────────

      const streamResult = provider.streamChat({
        messages,
        system: config.systemPrompt,
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
        ...(hasMcpTools ? { tools, maxSteps: 10 } : {}),
      });

      let fullText = '';
      for await (const chunk of streamResult.textStream) {
        fullText += chunk;
        ctx.emit({ type: 'text_delta', nodeId: ctx.node.id, delta: chunk });
      }

      logger.info(
        { nodeId: ctx.node.id, model: config.model, responseLength: fullText.length, hasMcpTools },
        'llm execution completed',
      );

      return {
        stateUpdates: { response: fullText },
        next: null,
        output: fullText,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'llm',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { messageCount: messages.length, model: config.model },
          output: { responseLength: fullText.length },
        },
      };
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'llm execution failed');
      throw error;
    } finally {
      await Promise.allSettled(mcpClients.map((c) => c.disconnect()));
    }
  }
}
```

- [ ] **Step 2: Run all executor tests**

```bash
bunx vitest run libs/agent-studio/src/execution/node-executors/node-executors.test.ts 2>&1 | tail -30
```

Expected: all tests pass — including the existing LLM tests (unchanged behaviour when `mcpServerIds` is absent) and the new MCP integration tests.

- [ ] **Step 3: Run full test suite**

```bash
bunx vitest run libs/agent-studio 2>&1 | tail -20
```

Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add libs/agent-studio/src/execution/node-executors/llm-executor.ts \
        libs/agent-studio/src/execution/node-executors/node-executors.test.ts
git commit -m "feat(agent-studio): add MCP tool-calling support to LLM node executor"
```

---

### Task 10: Update the LLM node form with MCP server multi-select

**Files:**
- Modify: `apps/web-ui/components/agents/config/llm-node-form.tsx`

- [ ] **Step 1: Replace the file with the MCP-aware form**

```typescript
// apps/web-ui/components/agents/config/llm-node-form.tsx
'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ProviderModelSelect } from '@/components/llm-providers/provider-model-select';
import type { LlmNodeConfig } from '@chatbot/agent-studio';
import { useMcpServers } from '@/hooks/use-mcp-servers';

const schema = z.object({
  model: z.string().min(1, 'Model is required'),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  contextChannels: z.array(z.string()).optional(),
  mcpServerIds: z.array(z.string()).optional(),
});

type LlmFormValues = z.infer<typeof schema>;

interface LlmNodeFormProps {
  config: LlmNodeConfig;
  onChange: (config: LlmNodeConfig) => void;
}

export function LlmNodeForm({ config, onChange }: LlmNodeFormProps) {
  const { data: mcpData, isLoading: mcpLoading } = useMcpServers({ pageSize: 100 });
  const servers = mcpData?.items ?? [];

  const form = useForm({
    defaultValues: {
      model: config.model ?? '',
      systemPrompt: config.systemPrompt ?? '',
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens,
      contextChannels: config.contextChannels ?? [],
      mcpServerIds: config.mcpServerIds ?? [],
    } as LlmFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'llm',
        model: value.model,
        systemPrompt: value.systemPrompt || undefined,
        temperature: value.temperature,
        maxTokens: value.maxTokens || undefined,
        contextChannels: value.contextChannels?.filter(Boolean).length
          ? value.contextChannels.filter(Boolean)
          : undefined,
        mcpServerIds: value.mcpServerIds?.filter(Boolean).length
          ? value.mcpServerIds.filter(Boolean)
          : undefined,
      });
    },
  });

  const handleBlur = () => form.handleSubmit();

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}
      className="space-y-4"
    >
      <form.Field name="model">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Model</Label>
            <ProviderModelSelect
              capability="chat"
              value={field.state.value ?? ''}
              onChange={(v) => { field.handleChange(v); handleBlur(); }}
              placeholder="Select a model"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="systemPrompt">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>System Prompt</Label>
            <Textarea
              id={field.name}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="You are a helpful assistant..."
              rows={4}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="temperature">
        {(field) => (
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Temperature</Label>
              <span className="text-xs text-muted-foreground">{field.state.value ?? 0.7}</span>
            </div>
            <Slider
              min={0}
              max={2}
              step={0.1}
              value={[field.state.value ?? 0.7]}
              onValueChange={(vals) => {
                const v = Array.isArray(vals) ? vals[0] : (vals as number);
                field.handleChange(v);
                handleBlur();
              }}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="maxTokens">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Max Tokens</Label>
            <Input
              id={field.name}
              type="number"
              min={1}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="Leave blank for default"
            />
          </div>
        )}
      </form.Field>

      <form.Field name="contextChannels">
        {(field) => {
          const channels = (field.state.value ?? []) as string[];
          return (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label>Context Channels</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    form.setFieldValue('contextChannels', [...channels, '']);
                    setTimeout(handleBlur, 0);
                  }}
                >
                  + Add
                </Button>
              </div>
              {channels.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Add the outputChannel name from an upstream KB, HTTP, or Code node (e.g.{' '}
                  <span className="font-mono">kb_results</span>).
                </p>
              ) : (
                channels.map((ch, idx) => (
                  <div key={idx} className="flex gap-1.5">
                    <Input
                      value={ch}
                      onChange={(e) => {
                        const next = [...channels];
                        next[idx] = e.target.value;
                        form.setFieldValue('contextChannels', next);
                      }}
                      onBlur={() => { field.handleBlur(); handleBlur(); }}
                      placeholder="e.g. kb_results"
                      className="flex-1 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 px-0 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        form.setFieldValue('contextChannels', channels.filter((_, i) => i !== idx));
                        setTimeout(handleBlur, 0);
                      }}
                    >
                      ×
                    </Button>
                  </div>
                ))
              )}
            </div>
          );
        }}
      </form.Field>

      {/* MCP Tools */}
      <form.Field name="mcpServerIds">
        {(field) => {
          const attached = (field.state.value ?? []) as string[];
          const attachedServers = attached
            .map((id) => servers.find((s) => s.id === id))
            .filter(Boolean) as typeof servers;

          const unattached = servers.filter((s) => !attached.includes(s.id) && s.status === 'active');

          return (
            <div className="grid gap-1.5">
              <Label>MCP Tools</Label>
              {attachedServers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Add MCP servers to let this LLM call their tools dynamically.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {attachedServers.map((server) => (
                    <Badge key={server.id} variant="secondary" className="gap-1 pr-1">
                      {server.name}
                      <button
                        type="button"
                        className="ml-1 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          form.setFieldValue('mcpServerIds', attached.filter((id) => id !== server.id));
                          setTimeout(handleBlur, 0);
                        }}
                        aria-label={`Remove ${server.name}`}
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              {unattached.length > 0 && (
                <Select
                  value=""
                  onValueChange={(v) => {
                    if (v && !attached.includes(v)) {
                      form.setFieldValue('mcpServerIds', [...attached, v]);
                      setTimeout(handleBlur, 0);
                    }
                  }}
                  disabled={mcpLoading}
                >
                  <SelectTrigger className="h-8 text-xs" aria-label="Add MCP server">
                    <SelectValue placeholder="+ Add MCP server" />
                  </SelectTrigger>
                  <SelectContent>
                    {unattached.map((server) => (
                      <SelectItem key={server.id} value={server.id}>
                        {server.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          );
        }}
      </form.Field>
    </form>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | grep "llm-node-form"
```

Expected: no output.

- [ ] **Step 3: Manual test in the browser**

With dev server running:
1. Open an agent → Graph tab → open an LLM node config panel
2. Scroll to the "MCP Tools" section at the bottom
3. Confirm it shows "Add MCP servers to let this LLM call their tools dynamically." when empty
4. Click "Add MCP server" dropdown — confirm your active MCP servers appear
5. Select a server — confirm it appears as a badge
6. Hit × on the badge — confirm it's removed
7. Save the graph
8. Run a query in playground — confirm the LLM can call MCP tools (check playground logs for "MCP tools discovered for LLM node")

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/components/agents/config/llm-node-form.tsx
git commit -m "feat(web-ui): add MCP Tools multi-select to LLM node form"
```

---

## Final Verification

- [ ] **Run all tests one last time**

```bash
bunx vitest run libs/agent-studio 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Type-check both packages**

```bash
bunx tsc --noEmit -p libs/agent-studio/tsconfig.json 2>&1 | grep -v "node_modules" | head -10
bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | grep -v "node_modules" | head -10
```

Expected: no new errors in modified files.

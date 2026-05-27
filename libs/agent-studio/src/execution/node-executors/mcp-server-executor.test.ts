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

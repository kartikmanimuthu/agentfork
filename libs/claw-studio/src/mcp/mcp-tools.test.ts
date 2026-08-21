import { describe, it, expect, vi } from 'vitest';

const mockFindMany = vi.fn();
vi.mock('@chatbot/agent-studio/services/mcp-server-service', () => ({
  McpServerService: vi.fn().mockImplementation(() => ({ findMany: mockFindMany })),
}));

const mockDiscoverTools = vi.fn();
const mockExecuteTool = vi.fn();
const mockDisconnect = vi.fn();
vi.mock('@chatbot/agent-studio/services/mcp-client.service', () => ({
  McpClientService: vi.fn().mockImplementation(() => ({
    discoverTools: mockDiscoverTools,
    executeTool: mockExecuteTool,
    disconnect: mockDisconnect,
  })),
}));

vi.mock('@chatbot/shared', () => ({
  getPrismaClient: vi.fn(() => ({})),
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

import { createMcpTools } from './mcp-tools';

describe('createMcpTools', () => {
  it('returns an empty tool list when the tenant has no active servers', async () => {
    mockFindMany.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    const { tools, cleanup } = await createMcpTools('tenant-1');
    expect(tools).toEqual([]);
    await expect(cleanup()).resolves.toBeUndefined();
  });

  it('namespaces tools as mcp_<serverName>_<toolName> and executes via the discovered client', async () => {
    mockFindMany.mockResolvedValue({
      items: [{ id: 's1', name: 'Grafana', status: 'active', config: { transport: 'sse', transportConfig: { endpoint: 'https://x' } } }],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    mockDiscoverTools.mockResolvedValue([
      { name: 'query_metrics', description: 'Query metrics', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
    ]);
    mockExecuteTool.mockResolvedValue('42');

    const { tools, cleanup } = await createMcpTools('tenant-1');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('mcp_grafana_query_metrics');

    const result = await tools[0].invoke({ q: 'cpu' } as any);
    expect(result).toBe('42');
    expect(mockExecuteTool).toHaveBeenCalledWith('query_metrics', { q: 'cpu' });

    await cleanup();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('skips a server that fails to connect and still returns tools from the others', async () => {
    mockFindMany.mockResolvedValue({
      items: [
        { id: 's1', name: 'Broken', status: 'active', config: { transport: 'sse', transportConfig: { endpoint: 'https://bad' } } },
        { id: 's2', name: 'Good', status: 'active', config: { transport: 'sse', transportConfig: { endpoint: 'https://good' } } },
      ],
      total: 2,
      page: 1,
      pageSize: 100,
    });
    mockDiscoverTools
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce([{ name: 'ping', description: '', inputSchema: {} }]);
    const { tools } = await createMcpTools('tenant-1');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('mcp_good_ping');
  });
});

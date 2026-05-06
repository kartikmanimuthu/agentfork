import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface McpServer {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  transport: 'sse' | 'stdio' | 'http_bridge';
  config: Record<string, unknown>;
  status: 'active' | 'inactive' | 'error';
  createdAt: string;
  updatedAt: string;
  _count?: { versions: number };
}

export interface McpServerListResult {
  items: McpServer[];
  total: number;
  page: number;
  pageSize: number;
}

export interface McpServerFilters {
  status?: string;
  transport?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

async function fetchMcpServers(filters: McpServerFilters = {}): Promise<McpServerListResult> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.transport) params.set('transport', filters.transport);
  if (filters.search) params.set('search', filters.search);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  const res = await fetch(`/api/mcp-servers?${params}`);
  if (!res.ok) throw new Error('Failed to fetch MCP servers');
  return res.json();
}

async function fetchMcpServer(id: string): Promise<McpServer> {
  const res = await fetch(`/api/mcp-servers/${id}`);
  if (!res.ok) throw new Error('Failed to fetch MCP server');
  return res.json();
}

async function createMcpServer(input: {
  name: string;
  description?: string;
  transport: string;
  config: Record<string, unknown>;
  changeNotes?: string;
}): Promise<McpServer> {
  const res = await fetch('/api/mcp-servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to create MCP server');
  }
  return res.json();
}

async function updateMcpServer(
  id: string,
  input: Partial<McpServer> & { changeNotes?: string }
): Promise<McpServer> {
  const res = await fetch(`/api/mcp-servers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to update MCP server');
  }
  return res.json();
}

async function deleteMcpServer(id: string): Promise<void> {
  const res = await fetch(`/api/mcp-servers/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete MCP server');
}

async function testMcpServer(id: string): Promise<{ connected: boolean; error?: string }> {
  const res = await fetch(`/api/mcp-servers/${id}/test`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to test MCP server');
  return res.json();
}

async function restoreMcpServerVersion(
  id: string,
  versionId: string
): Promise<McpServer> {
  const res = await fetch(`/api/mcp-servers/${id}/versions/${versionId}/restore`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to restore version');
  return res.json();
}

async function fetchMcpServerVersions(id: string): Promise<unknown[]> {
  const res = await fetch(`/api/mcp-servers/${id}/versions`);
  if (!res.ok) throw new Error('Failed to fetch versions');
  return res.json();
}

async function fetchAgentMcpServers(agentId: string): Promise<McpServer[]> {
  const res = await fetch(`/api/agents/${agentId}/mcp-servers`);
  if (!res.ok) throw new Error('Failed to fetch agent MCP servers');
  return res.json();
}

async function attachMcpServer(agentId: string, mcpServerId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/mcp-servers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mcpServerId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to attach MCP server');
  }
}

async function detachMcpServer(agentId: string, mcpServerId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/mcp-servers/${mcpServerId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to detach MCP server');
}

export const mcpServerKeys = {
  all: ['mcp-servers'] as const,
  lists: () => [...mcpServerKeys.all, 'list'] as const,
  list: (filters: McpServerFilters) => [...mcpServerKeys.lists(), filters] as const,
  details: () => [...mcpServerKeys.all, 'detail'] as const,
  detail: (id: string) => [...mcpServerKeys.details(), id] as const,
  versions: (id: string) => [...mcpServerKeys.detail(id), 'versions'] as const,
  agentServers: (agentId: string) => ['agents', agentId, 'mcp-servers'] as const,
};

export function useMcpServers(filters: McpServerFilters = {}) {
  return useQuery({ queryKey: mcpServerKeys.list(filters), queryFn: () => fetchMcpServers(filters) });
}

export function useMcpServer(id: string) {
  return useQuery({ queryKey: mcpServerKeys.detail(id), queryFn: () => fetchMcpServer(id), enabled: Boolean(id) });
}

export function useCreateMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMcpServer,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mcpServerKeys.lists() }),
  });
}

export function useUpdateMcpServer(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<McpServer> & { changeNotes?: string }) => updateMcpServer(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.lists() });
    },
  });
}

export function useDeleteMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMcpServer,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mcpServerKeys.lists() }),
  });
}

export function useTestMcpServer(id: string) {
  return useMutation({ mutationFn: () => testMcpServer(id) });
}

export function useMcpServerVersions(id: string) {
  return useQuery({ queryKey: mcpServerKeys.versions(id), queryFn: () => fetchMcpServerVersions(id), enabled: Boolean(id) });
}

export function useRestoreMcpServerVersion(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => restoreMcpServerVersion(id, versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.versions(id) });
    },
  });
}

export function useAgentMcpServers(agentId: string) {
  return useQuery({ queryKey: mcpServerKeys.agentServers(agentId), queryFn: () => fetchAgentMcpServers(agentId), enabled: Boolean(agentId) });
}

export function useAttachMcpServer(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mcpServerId: string) => attachMcpServer(agentId, mcpServerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.agentServers(agentId) });
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.lists() });
    },
  });
}

export function useDetachMcpServer(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mcpServerId: string) => detachMcpServer(agentId, mcpServerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.agentServers(agentId) });
      queryClient.invalidateQueries({ queryKey: mcpServerKeys.lists() });
    },
  });
}

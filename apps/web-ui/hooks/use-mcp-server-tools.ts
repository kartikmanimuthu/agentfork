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

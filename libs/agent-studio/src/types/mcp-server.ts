export type McpServerTransport = 'sse' | 'stdio' | 'http_bridge';

export type McpServerStatus = 'active' | 'inactive' | 'error';

export interface SseTransportConfig {
  endpoint: string;
  headers?: Record<string, string>;
}

export interface StdioTransportConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HttpBridgeTransportConfig {
  bridgeUrl: string;
  targetCommand?: string;
}

export type McpServerTransportConfig =
  | SseTransportConfig
  | StdioTransportConfig
  | HttpBridgeTransportConfig;

export interface McpServerConfig {
  transport: McpServerTransport;
  transportConfig: McpServerTransportConfig;
  timeoutMs?: number;
  retryCount?: number;
}

export interface McpServer {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  transport: McpServerTransport;
  config: McpServerConfig;
  status: McpServerStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface McpServerVersion {
  id: string;
  mcpServerId: string;
  version: number;
  config: McpServerConfig;
  changeNotes: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface CreateMcpServerInput {
  name: string;
  description?: string;
  transport: McpServerTransport;
  config: McpServerConfig;
}

export interface UpdateMcpServerInput {
  name?: string;
  description?: string;
  transport?: McpServerTransport;
  config?: McpServerConfig;
}

export interface McpServerFilters {
  status?: McpServerStatus;
  transport?: McpServerTransport;
  search?: string;
  page?: number;
  pageSize?: number;
}

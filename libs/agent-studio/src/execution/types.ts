import type { GraphNode } from '../types/agent';
import type { NodeConfig } from '../types/nodes';

export interface GraphState {
  channels: Record<string, unknown>;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  currentNodeId: string | null;
  metadata: {
    executionId: string;
    agentId: string;
    tenantId: string;
    userId: string;
    startedAt: Date;
  };
}

export interface ExecutionServices {
  llmProvider: (providerId?: string, modelId?: string) => Promise<any>;
  prisma: any;
  /**
   * Optional tool registry for built-in and MCP tools.
   * Keyed by tool name; each entry follows the Vercel AI SDK ToolSet shape
   * (description + inputSchema + execute). Typed loosely so MCP and built-in
   * tool shapes can coexist without coupling agent-studio to the `ai` package.
   */
  toolRegistry?: Record<string, unknown>;
}

export interface NodeExecutionContext {
  state: GraphState;
  node: GraphNode;
  config: NodeConfig;
  services: ExecutionServices;
  emit: (event: ExecutionEvent) => void;
}

export interface NodeExecutor {
  type: string;
  execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult>;
}

export interface NodeExecutionResult {
  stateUpdates: Record<string, unknown>;
  next: string[] | null;
  output?: string;
  trace: NodeTraceEntry;
}

export interface NodeTraceEntry {
  nodeId: string;
  nodeType: string;
  nodeLabel?: string;
  status: 'completed' | 'failed' | 'skipped' | 'paused';
  startedAt: string;
  completedAt?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
}

export type ExecutionEvent =
  | { type: 'node_start'; nodeId: string; nodeType: string }
  | { type: 'node_complete'; nodeId: string; trace: NodeTraceEntry }
  | { type: 'node_error'; nodeId: string; error: string }
  | { type: 'text_delta'; nodeId: string; delta: string }
  | { type: 'state_update'; channels: Record<string, unknown> }
  | { type: 'execution_complete'; finalState: GraphState; trace: NodeTraceEntry[] }
  | { type: 'execution_paused'; reason: string; resumeToken: string };

export interface ExecutionOptions {
  onEvent?: (event: ExecutionEvent) => void;
  signal?: AbortSignal;
  maxSteps?: number;
}

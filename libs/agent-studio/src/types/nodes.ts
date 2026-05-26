// ─── Primitives ───────────────────────────────────────────────────────────────

export type NodeType = 'llm' | 'tool' | 'router' | 'state_schema' | 'input' | 'output' | 'memory' | 'knowledge_base' | 'mcp_server' | 'code' | 'condition' | 'http' | 'human' | 'parallel' | 'sub_agent' | 'delay';

export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  description?: string;
  default?: unknown;
}

export interface ToolConfig {
  name: string;
  description: string;
  parameters: SchemaField[];
}

// ─── Per-node configs (discriminated union on `type`) ─────────────────────────

export interface LlmNodeConfig {
  type: 'llm';
  model: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** Tool names wired into this node */
  tools?: string[];
  /** Channel names whose string values are injected as RAG context into the last user message */
  contextChannels?: string[];
}

export interface ToolNodeConfig {
  type: 'tool';
  toolName: string;
  /** Static parameter overrides */
  parameters?: Record<string, unknown>;
}

export interface RouterNodeConfig {
  type: 'router';
  mode?: 'expression' | 'natural_language';
  conditions: Array<{
    /** Boolean JS expression (expression mode) or plain English (natural_language mode) */
    condition: string;
    target: string;
  }>;
  defaultTarget?: string;
  /** Temperature for LLM classification in natural_language mode (0–1, default 0) */
  nlTemperature?: number;
}

export interface StateSchemaNodeConfig {
  type: 'state_schema';
  fields: SchemaField[];
}

export interface InputNodeConfig {
  type: 'input';
  mode: 'messages' | 'structured';
  inputSchema?: SchemaField[];
}

export interface OutputNodeConfig {
  type: 'output';
  responseChannel: string;
  format: 'text' | 'json' | 'stream';
}

export interface MemoryNodeConfig {
  type: 'memory';
  strategy: 'full' | 'sliding_window' | 'summary' | 'token_limit';
  maxMessages?: number;
  maxTokens?: number;
  messagesChannel: string;
  keepRecent?: number;
}

export interface KnowledgeBaseNodeConfig {
  type: 'knowledge_base';
  knowledgeBaseIds: string[];
  queryChannel: string;
  outputChannel: string;
  topK: number;
  threshold?: number;
}

export interface McpServerNodeConfig {
  type: 'mcp_server';
  serverId: string;
  toolName: string;
  argumentSource: 'from_state' | 'static';
  staticArguments?: Record<string, unknown>;
  channelMappings?: Record<string, string>;
  outputChannel: string;
}

export interface CodeNodeConfig {
  type: 'code';
  code: string;
  language: 'javascript' | 'typescript';
  inputChannels: string[];
  outputChannel: string;
  timeoutMs?: number;
}

export interface ConditionNodeConfig {
  type: 'condition';
  expression: string;
  trueBranch: string;
  falseBranch: string;
}

export interface HttpNodeConfig {
  type: 'http';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
  bodyChannel?: string;
  outputChannel: string;
  timeoutMs?: number;
}

export interface HumanNodeConfig {
  type: 'human';
  prompt: string;
  outputChannel: string;
  timeoutMs?: number;
}

export interface ParallelNodeConfig {
  type: 'parallel';
  branches: string[];
  mergeStrategy: 'all' | 'race' | 'any';
  outputChannel: string;
}

export interface SubAgentNodeConfig {
  type: 'sub_agent';
  agentId: string;
  versionId?: string;
  alias?: string;
  inputChannel: string;
  outputChannel: string;
}

export interface DelayNodeConfig {
  type: 'delay';
  delayMs: number;
  delayChannel?: string;
}

/** Discriminated union of all node configuration shapes */
export type NodeConfig =
  | LlmNodeConfig
  | ToolNodeConfig
  | RouterNodeConfig
  | StateSchemaNodeConfig
  | InputNodeConfig
  | OutputNodeConfig
  | MemoryNodeConfig
  | KnowledgeBaseNodeConfig
  | McpServerNodeConfig
  | CodeNodeConfig
  | ConditionNodeConfig
  | HttpNodeConfig
  | HumanNodeConfig
  | ParallelNodeConfig
  | SubAgentNodeConfig
  | DelayNodeConfig;

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationError {
  /** Dot-path to the offending field, e.g. "nodes[0].config.model" */
  field: string;
  message: string;
  code?: string;
}

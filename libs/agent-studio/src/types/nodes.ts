// ─── Primitives ───────────────────────────────────────────────────────────────

export type NodeType = 'llm' | 'tool' | 'router' | 'state_schema';

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
}

export interface ToolNodeConfig {
  type: 'tool';
  toolName: string;
  /** Static parameter overrides */
  parameters?: Record<string, unknown>;
}

export interface RouterNodeConfig {
  type: 'router';
  conditions: Array<{
    /** Boolean expression evaluated at runtime */
    condition: string;
    /** Target node id */
    target: string;
  }>;
  defaultTarget?: string;
}

export interface StateSchemaNodeConfig {
  type: 'state_schema';
  fields: SchemaField[];
}

/** Discriminated union of all node configuration shapes */
export type NodeConfig =
  | LlmNodeConfig
  | ToolNodeConfig
  | RouterNodeConfig
  | StateSchemaNodeConfig;

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationError {
  /** Dot-path to the offending field, e.g. "nodes[0].config.model" */
  field: string;
  message: string;
  code?: string;
}

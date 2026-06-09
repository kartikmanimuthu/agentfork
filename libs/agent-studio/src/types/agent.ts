import type { NodeConfig } from './nodes';

// ─── Enums ────────────────────────────────────────────────────────────────────

export type AgentType = 'simple' | 'graph';

export type AgentStatus = 'active' | 'inactive' | 'draft';

export type AgentVersionStatus = 'draft' | 'published' | 'archived';

// ─── Graph primitives ─────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  config: NodeConfig;
  /** React Flow canvas position */
  position: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  /** Condition expression used by router nodes */
  condition?: string;
}

export interface GraphDefinition {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ─── Simple agent config ──────────────────────────────────────────────────────

export interface SimpleAgentConfig {
  model: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  /** Names of tools available to this agent */
  tools?: string[];
}

// ─── CRUD inputs ──────────────────────────────────────────────────────────────

export interface CreateAgentInput {
  tenantId: string;
  name: string;
  description?: string;
  type: AgentType;
  config: SimpleAgentConfig | GraphDefinition;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  status?: AgentStatus;
  config?: SimpleAgentConfig | GraphDefinition;
  showThinking?: boolean;
}

// ─── Query filters ────────────────────────────────────────────────────────────

export interface AgentFilters {
  tenantId: string;
  status?: AgentStatus;
  type?: AgentType;
  /** Full-text search against name / description */
  search?: string;
  page?: number;
  pageSize?: number;
}

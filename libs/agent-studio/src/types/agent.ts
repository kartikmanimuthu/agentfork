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
  /** @deprecated Read via resolveCachingConfig(). Superseded by `caching`. */
  cacheTtlMinutes?: number;
  /** @deprecated Read via resolveCachingConfig(). Superseded by `caching`. */
  semanticCache?: {
    enabled: boolean;
    embeddingModel: string;
    threshold: number;
  };
  caching?: {
    exact?: {
      enabled: boolean;
      ttlSeconds: number;
      overrides?: { withTools?: boolean; inSessions?: boolean };
    };
    semantic?: {
      enabled: boolean;
      ttlSeconds: number;
      embeddingModel: string;
      threshold: number;
      overrides?: {
        withTools?: boolean;
        inSessions?: boolean;
        withAttachments?: boolean;
        withKnowledgeBase?: boolean;
      };
    };
    /** @deprecated Shared overrides, superseded by the per-tier `overrides`. */
    overrides?: {
      withMcpTools?: boolean;
      withBuiltInTools?: boolean;
      inSessions?: boolean;
      withAttachments?: boolean;
      withKnowledgeBase?: boolean;
    };
  };
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

# Agent Studio Canvas + Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Agent Studio module — visual LangGraph canvas, agent configuration panel, service layer library, data model, and API routes within the existing chatbot monorepo.

**Architecture:** Service Layer Extraction (Approach B). New `libs/agent-studio` library for domain logic. Canvas UI in `apps/web-ui` under `(dashboard)/agents`. Two agent types: simple (form-based, LangChain.js) and workflow (canvas, LangGraph.js). React Flow canvas, TanStack Query, Zustand store.

**Tech Stack:** TypeScript, Next.js 15, React Flow (`@xyflow/react`), TanStack Query, Zustand, Prisma, PostgreSQL, Zod, shadcn/ui, Monaco Editor, Vitest

---

## File Structure

### New library: `libs/agent-studio/`

```
libs/agent-studio/
  src/
    index.ts                          # Public API exports
    types/
      agent.ts                        # Agent, AgentVersion, GraphDefinition, SimpleAgentConfig
      nodes.ts                        # GraphNode, GraphEdge, NodeConfig, ValidationError
    registry/
      node-registry.ts                # NodeTypeDefinition interface + NodeRegistry class
      nodes/
        llm-node.ts                   # LLM node definition + Zod schema
        tool-node.ts                  # Tool node definition + Zod schema
        router-node.ts               # Router node definition + Zod schema
        state-schema-node.ts          # State Schema node definition + Zod schema
    services/
      agent-service.ts                # AgentService class (CRUD)
      agent-service.test.ts
      agent-version-service.ts        # AgentVersionService class (versioning)
      agent-version-service.test.ts
      graph-validation-service.ts     # GraphValidationService class
      graph-validation-service.test.ts
    validation/
      rules.ts                        # All validation rule functions
      rules.test.ts
  vitest.config.ts
  project.json
  tsconfig.json
  tsconfig.lib.json
  package.json
```

### New frontend files: `apps/web-ui/`

```
apps/web-ui/
  app/(dashboard)/agents/
    page.tsx                          # Agent list page
    layout.tsx                        # Agents layout
    [id]/
      page.tsx                        # Canvas (workflow) or config form (simple)
      settings/
        page.tsx                      # Agent settings page
  app/api/agents/
    route.ts                          # POST + GET
    [id]/
      route.ts                        # GET + PATCH + DELETE
      versions/
        route.ts                      # POST + GET
        [version]/
          route.ts                    # GET specific version
          publish/
            route.ts                  # POST publish
      validate/
        route.ts                      # POST validate
  components/agent-studio/
    canvas/
      agent-canvas.tsx                # React Flow canvas wrapper
      node-palette.tsx                # Left sidebar draggable nodes
      config-panel.tsx                # Right panel config forms
      canvas-toolbar.tsx              # Top bar (save, publish, undo/redo)
      canvas-status-bar.tsx           # Bottom status bar
    nodes/
      llm-node.tsx                    # Custom React Flow LLM node
      tool-node.tsx                   # Custom React Flow Tool node
      router-node.tsx                 # Custom React Flow Router node
      state-schema-node.tsx           # Custom React Flow State Schema node
      node-types.ts                   # nodeTypes registry object for React Flow
    forms/
      llm-config-form.tsx
      tool-config-form.tsx
      router-config-form.tsx
      state-schema-form.tsx
      simple-agent-form.tsx
    agent-list.tsx                    # Agent list with cards
    create-agent-dialog.tsx           # Create agent modal
  stores/
    agent-canvas-store.ts             # Zustand store
  hooks/
    use-agents.ts                     # TanStack Query hooks for list/single
    use-agent-versions.ts             # TanStack Query hooks for versions
```

### Modified files

- `prisma/schema.prisma` — Add Agent, AgentVersion, AgentExecution models + Tenant relation
- `tsconfig.base.json` — Add `@chatbot/agent-studio` path alias
- `libs/shared/src/rbac/types.ts` — Add `'Agents'` to Module type
- `libs/shared/src/rbac/permissions.ts` — Add Agents permissions per role
- `apps/web-ui/components/app-sidebar.tsx` — Add Agent Studio nav item

---

## Task 1: Scaffold `libs/agent-studio` library

**Files:**
- Create: `libs/agent-studio/package.json`
- Create: `libs/agent-studio/project.json`
- Create: `libs/agent-studio/tsconfig.json`
- Create: `libs/agent-studio/tsconfig.lib.json`
- Create: `libs/agent-studio/vitest.config.ts`
- Create: `libs/agent-studio/src/index.ts`
- Modify: `tsconfig.base.json`

- [ ] **Step 1: Create `libs/agent-studio/package.json`**

```json
{
  "name": "@chatbot/agent-studio",
  "version": "0.0.1",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [ ] **Step 2: Create `libs/agent-studio/project.json`**

```json
{
  "name": "agent-studio",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/agent-studio/src",
  "projectType": "library",
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/agent-studio",
        "tsConfig": "libs/agent-studio/tsconfig.lib.json",
        "main": "libs/agent-studio/src/index.ts"
      }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": {
        "command": "bunx vitest run",
        "cwd": "libs/agent-studio"
      }
    }
  }
}
```

- [ ] **Step 3: Create `libs/agent-studio/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": false,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "files": [],
  "include": [],
  "references": [
    { "path": "./tsconfig.lib.json" }
  ]
}
```

- [ ] **Step 4: Create `libs/agent-studio/tsconfig.lib.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "vitest.config.ts"]
}
```

- [ ] **Step 5: Create `libs/agent-studio/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 6: Create `libs/agent-studio/src/index.ts`**

```typescript
// Types
export type {
  AgentType,
  AgentStatus,
  AgentVersionStatus,
  CreateAgentInput,
  UpdateAgentInput,
  AgentFilters,
  GraphDefinition,
  GraphNode,
  GraphEdge,
  SimpleAgentConfig,
} from './types/agent';

export type {
  NodeType,
  NodeConfig,
  LlmNodeConfig,
  ToolNodeConfig,
  RouterNodeConfig,
  StateSchemaNodeConfig,
  ToolConfig,
  SchemaField,
  ValidationError,
} from './types/nodes';

// Registry
export { NodeRegistry } from './registry/node-registry';

// Services
export { AgentService } from './services/agent-service';
export { AgentVersionService } from './services/agent-version-service';
export { GraphValidationService } from './services/graph-validation-service';
```

- [ ] **Step 7: Add path alias to `tsconfig.base.json`**

Add to the `paths` object in `tsconfig.base.json`:

```json
"@chatbot/agent-studio": ["libs/agent-studio/src/index.ts"]
```

- [ ] **Step 8: Verify the library is recognized by Nx**

Run: `nx show project agent-studio`

Expected: Shows project configuration with build and test targets.

- [ ] **Step 9: Commit**

```bash
git add libs/agent-studio/ tsconfig.base.json
git commit -m "feat(agent-studio): scaffold libs/agent-studio library with Nx project config"
```

---

## Task 2: Define types

**Files:**
- Create: `libs/agent-studio/src/types/agent.ts`
- Create: `libs/agent-studio/src/types/nodes.ts`

- [ ] **Step 1: Create `libs/agent-studio/src/types/agent.ts`**

```typescript
import type { NodeConfig } from './nodes';

export type AgentType = 'simple' | 'workflow';
export type AgentStatus = 'draft' | 'published' | 'archived';
export type AgentVersionStatus = 'draft' | 'published';

export interface CreateAgentInput {
  name: string;
  description?: string;
  type: AgentType;
  tags?: string[];
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  tags?: string[];
}

export interface AgentFilters {
  type?: AgentType;
  status?: AgentStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface GraphDefinition {
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewport: { x: number; y: number; zoom: number };
}

export interface GraphNode {
  id: string;
  type: 'llm' | 'tool' | 'router' | 'state-schema';
  position: { x: number; y: number };
  data: NodeConfig;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
  data?: { condition?: string };
}

export interface SimpleAgentConfig {
  model: { provider: string; modelId: string };
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  tools: ToolConfigRef[];
  memory: {
    contextWindowSize: number;
    summarizationTrigger?: number;
  };
}

export interface ToolConfigRef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
```

- [ ] **Step 2: Create `libs/agent-studio/src/types/nodes.ts`**

```typescript
export type NodeType = 'llm' | 'tool' | 'router' | 'state-schema';

export type NodeConfig =
  | LlmNodeConfig
  | ToolNodeConfig
  | RouterNodeConfig
  | StateSchemaNodeConfig;

export interface LlmNodeConfig {
  nodeType: 'llm';
  provider: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  stopSequences: string[];
}

export interface ToolConfig {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  implementation?: string;
}

export interface ToolNodeConfig {
  nodeType: 'tool';
  tools: ToolConfig[];
}

export interface RouterNodeConfig {
  nodeType: 'router';
  conditionType: 'natural-language' | 'code';
  condition: string;
}

export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  defaultValue?: unknown;
}

export interface StateSchemaNodeConfig {
  nodeType: 'state-schema';
  fields: SchemaField[];
}

export interface ValidationError {
  nodeId?: string;
  edgeId?: string;
  rule: string;
  message: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add libs/agent-studio/src/types/
git commit -m "feat(agent-studio): add agent and node type definitions"
```

---

## Task 3: Build node registry with Zod schemas

**Files:**
- Create: `libs/agent-studio/src/registry/node-registry.ts`
- Create: `libs/agent-studio/src/registry/nodes/llm-node.ts`
- Create: `libs/agent-studio/src/registry/nodes/tool-node.ts`
- Create: `libs/agent-studio/src/registry/nodes/router-node.ts`
- Create: `libs/agent-studio/src/registry/nodes/state-schema-node.ts`

- [ ] **Step 1: Create `libs/agent-studio/src/registry/node-registry.ts`**

```typescript
import { z } from 'zod';
import type { NodeType, NodeConfig } from '../types/nodes';

export interface HandleDefinition {
  type: 'source' | 'target';
  position: 'top' | 'bottom' | 'left' | 'right';
  id?: string;
}

export interface NodeTypeDefinition {
  type: NodeType;
  label: string;
  category: 'AI' | 'Logic' | 'Data';
  icon: string;
  defaultConfig: NodeConfig;
  configSchema: z.ZodType;
  handles: HandleDefinition[];
}

export class NodeRegistry {
  private static definitions = new Map<NodeType, NodeTypeDefinition>();

  static register(definition: NodeTypeDefinition): void {
    this.definitions.set(definition.type, definition);
  }

  static get(type: NodeType): NodeTypeDefinition | undefined {
    return this.definitions.get(type);
  }

  static getAll(): NodeTypeDefinition[] {
    return Array.from(this.definitions.values());
  }

  static getByCategory(category: string): NodeTypeDefinition[] {
    return this.getAll().filter((d) => d.category === category);
  }

  static validateConfig(type: NodeType, config: unknown): { success: boolean; errors?: string[] } {
    const def = this.definitions.get(type);
    if (!def) return { success: false, errors: [`Unknown node type: ${type}`] };
    const result = def.configSchema.safeParse(config);
    if (result.success) return { success: true };
    return { success: false, errors: result.error.errors.map((e) => e.message) };
  }

  static clear(): void {
    this.definitions.clear();
  }
}
```

- [ ] **Step 2: Create `libs/agent-studio/src/registry/nodes/llm-node.ts`**

```typescript
import { z } from 'zod';
import { NodeRegistry } from '../node-registry';
import type { LlmNodeConfig } from '../../types/nodes';

export const llmNodeConfigSchema = z.object({
  nodeType: z.literal('llm'),
  provider: z.string().min(1, 'Provider is required'),
  modelId: z.string().min(1, 'Model ID is required'),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().positive(),
  systemPrompt: z.string(),
  stopSequences: z.array(z.string()),
});

const defaultConfig: LlmNodeConfig = {
  nodeType: 'llm',
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-20250514',
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: '',
  stopSequences: [],
};

NodeRegistry.register({
  type: 'llm',
  label: 'LLM',
  category: 'AI',
  icon: 'brain',
  defaultConfig,
  configSchema: llmNodeConfigSchema,
  handles: [
    { type: 'target', position: 'top' },
    { type: 'source', position: 'bottom' },
  ],
});
```

- [ ] **Step 3: Create `libs/agent-studio/src/registry/nodes/tool-node.ts`**

```typescript
import { z } from 'zod';
import { NodeRegistry } from '../node-registry';
import type { ToolNodeConfig } from '../../types/nodes';

export const toolNodeConfigSchema = z.object({
  nodeType: z.literal('tool'),
  tools: z.array(z.object({
    name: z.string().min(1, 'Tool name is required'),
    description: z.string(),
    parameters: z.record(z.unknown()),
    implementation: z.string().optional(),
  })).min(1, 'At least one tool is required'),
});

const defaultConfig: ToolNodeConfig = {
  nodeType: 'tool',
  tools: [{ name: '', description: '', parameters: {} }],
};

NodeRegistry.register({
  type: 'tool',
  label: 'Tool',
  category: 'AI',
  icon: 'wrench',
  defaultConfig,
  configSchema: toolNodeConfigSchema,
  handles: [
    { type: 'target', position: 'top' },
    { type: 'source', position: 'bottom' },
  ],
});
```

- [ ] **Step 4: Create `libs/agent-studio/src/registry/nodes/router-node.ts`**

```typescript
import { z } from 'zod';
import { NodeRegistry } from '../node-registry';
import type { RouterNodeConfig } from '../../types/nodes';

export const routerNodeConfigSchema = z.object({
  nodeType: z.literal('router'),
  conditionType: z.enum(['natural-language', 'code']),
  condition: z.string().min(1, 'Condition is required'),
});

const defaultConfig: RouterNodeConfig = {
  nodeType: 'router',
  conditionType: 'natural-language',
  condition: '',
};

NodeRegistry.register({
  type: 'router',
  label: 'Router',
  category: 'Logic',
  icon: 'git-branch',
  defaultConfig,
  configSchema: routerNodeConfigSchema,
  handles: [
    { type: 'target', position: 'top' },
    { type: 'source', position: 'bottom', id: 'true' },
    { type: 'source', position: 'right', id: 'false' },
  ],
});
```

- [ ] **Step 5: Create `libs/agent-studio/src/registry/nodes/state-schema-node.ts`**

```typescript
import { z } from 'zod';
import { NodeRegistry } from '../node-registry';
import type { StateSchemaNodeConfig } from '../../types/nodes';

export const stateSchemaNodeConfigSchema = z.object({
  nodeType: z.literal('state-schema'),
  fields: z.array(z.object({
    name: z.string().min(1, 'Field name is required'),
    type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
    defaultValue: z.unknown().optional(),
  })).min(1, 'At least one field is required'),
});

const defaultConfig: StateSchemaNodeConfig = {
  nodeType: 'state-schema',
  fields: [{ name: 'messages', type: 'array' }],
};

NodeRegistry.register({
  type: 'state-schema',
  label: 'State Schema',
  category: 'Data',
  icon: 'database',
  defaultConfig,
  configSchema: stateSchemaNodeConfigSchema,
  handles: [
    { type: 'source', position: 'bottom' },
  ],
});
```

- [ ] **Step 6: Verify registry loads all nodes**

Run: `nx test agent-studio` (will fail — no tests yet, but verifies compilation)

- [ ] **Step 7: Commit**

```bash
git add libs/agent-studio/src/registry/
git commit -m "feat(agent-studio): add node registry with Zod schemas for LLM, Tool, Router, State Schema"
```

---

## Task 4: Graph validation rules + tests

**Files:**
- Create: `libs/agent-studio/src/validation/rules.ts`
- Create: `libs/agent-studio/src/validation/rules.test.ts`

- [ ] **Step 1: Write failing tests for all validation rules**

Create `libs/agent-studio/src/validation/rules.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  validateNoOrphanNodes,
  validateEntryNodeExists,
  validateValidConnections,
  validateRouterEdgeCount,
  validateStateSchemaRequired,
} from './rules';
import type { GraphDefinition } from '../types/agent';

const makeGraph = (overrides: Partial<GraphDefinition> = {}): GraphDefinition => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  ...overrides,
});

describe('validateNoOrphanNodes', () => {
  it('returns no errors when all nodes are connected', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'n1', type: 'llm', position: { x: 0, y: 0 }, data: { nodeType: 'llm' } as any },
        { id: 'n2', type: 'tool', position: { x: 0, y: 100 }, data: { nodeType: 'tool' } as any },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    });
    expect(validateNoOrphanNodes(graph)).toEqual([]);
  });

  it('returns error for orphan node', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'n1', type: 'llm', position: { x: 0, y: 0 }, data: { nodeType: 'llm' } as any },
        { id: 'n2', type: 'tool', position: { x: 0, y: 100 }, data: { nodeType: 'tool' } as any },
        { id: 'n3', type: 'llm', position: { x: 200, y: 0 }, data: { nodeType: 'llm' } as any },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    });
    const errors = validateNoOrphanNodes(graph);
    expect(errors).toHaveLength(1);
    expect(errors[0].nodeId).toBe('n3');
    expect(errors[0].rule).toBe('no-orphan-nodes');
  });
});

describe('validateEntryNodeExists', () => {
  it('returns no errors when graph has exactly one state-schema node', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'n1', type: 'state-schema', position: { x: 0, y: 0 }, data: { nodeType: 'state-schema' } as any },
        { id: 'n2', type: 'llm', position: { x: 0, y: 100 }, data: { nodeType: 'llm' } as any },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    });
    expect(validateEntryNodeExists(graph)).toEqual([]);
  });

  it('returns error when no state-schema node exists', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'n1', type: 'llm', position: { x: 0, y: 0 }, data: { nodeType: 'llm' } as any },
      ],
      edges: [],
    });
    const errors = validateEntryNodeExists(graph);
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('entry-node-exists');
  });
});

describe('validateValidConnections', () => {
  it('returns no errors when all edges reference valid nodes', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'n1', type: 'llm', position: { x: 0, y: 0 }, data: { nodeType: 'llm' } as any },
        { id: 'n2', type: 'tool', position: { x: 0, y: 100 }, data: { nodeType: 'tool' } as any },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    });
    expect(validateValidConnections(graph)).toEqual([]);
  });

  it('returns error for edge referencing non-existent node', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'n1', type: 'llm', position: { x: 0, y: 0 }, data: { nodeType: 'llm' } as any },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n999' }],
    });
    const errors = validateValidConnections(graph);
    expect(errors).toHaveLength(1);
    expect(errors[0].edgeId).toBe('e1');
    expect(errors[0].rule).toBe('valid-connections');
  });
});

describe('validateRouterEdgeCount', () => {
  it('returns no errors when router has 2+ outgoing edges', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'r1', type: 'router', position: { x: 0, y: 0 }, data: { nodeType: 'router' } as any },
        { id: 'n1', type: 'llm', position: { x: -100, y: 100 }, data: { nodeType: 'llm' } as any },
        { id: 'n2', type: 'llm', position: { x: 100, y: 100 }, data: { nodeType: 'llm' } as any },
      ],
      edges: [
        { id: 'e1', source: 'r1', target: 'n1' },
        { id: 'e2', source: 'r1', target: 'n2' },
      ],
    });
    expect(validateRouterEdgeCount(graph)).toEqual([]);
  });

  it('returns error when router has fewer than 2 outgoing edges', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'r1', type: 'router', position: { x: 0, y: 0 }, data: { nodeType: 'router' } as any },
        { id: 'n1', type: 'llm', position: { x: 0, y: 100 }, data: { nodeType: 'llm' } as any },
      ],
      edges: [{ id: 'e1', source: 'r1', target: 'n1' }],
    });
    const errors = validateRouterEdgeCount(graph);
    expect(errors).toHaveLength(1);
    expect(errors[0].nodeId).toBe('r1');
    expect(errors[0].rule).toBe('router-edge-count');
  });
});

describe('validateStateSchemaRequired', () => {
  it('returns no errors when state-schema node exists', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'n1', type: 'state-schema', position: { x: 0, y: 0 }, data: { nodeType: 'state-schema' } as any },
      ],
      edges: [],
    });
    expect(validateStateSchemaRequired(graph)).toEqual([]);
  });

  it('returns error when no state-schema node', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'n1', type: 'llm', position: { x: 0, y: 0 }, data: { nodeType: 'llm' } as any },
      ],
      edges: [],
    });
    const errors = validateStateSchemaRequired(graph);
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('state-schema-required');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd libs/agent-studio && bunx vitest run`

Expected: All tests FAIL (module not found).

- [ ] **Step 3: Implement validation rules**

Create `libs/agent-studio/src/validation/rules.ts`:

```typescript
import type { GraphDefinition } from '../types/agent';
import type { ValidationError } from '../types/nodes';

export function validateNoOrphanNodes(graph: GraphDefinition): ValidationError[] {
  const connectedNodeIds = new Set<string>();
  for (const edge of graph.edges) {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
  }
  return graph.nodes
    .filter((node) => !connectedNodeIds.has(node.id))
    .map((node) => ({
      nodeId: node.id,
      rule: 'no-orphan-nodes',
      message: `Node "${node.id}" is not connected to any other node`,
    }));
}

export function validateEntryNodeExists(graph: GraphDefinition): ValidationError[] {
  const stateSchemaNodes = graph.nodes.filter((n) => n.type === 'state-schema');
  if (stateSchemaNodes.length === 0) {
    return [{ rule: 'entry-node-exists', message: 'Graph must have a State Schema node as entry point' }];
  }
  if (stateSchemaNodes.length > 1) {
    return stateSchemaNodes.slice(1).map((n) => ({
      nodeId: n.id,
      rule: 'entry-node-exists',
      message: 'Graph must have exactly one State Schema node',
    }));
  }
  return [];
}

export function validateValidConnections(graph: GraphDefinition): ValidationError[] {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  return graph.edges
    .filter((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))
    .map((edge) => ({
      edgeId: edge.id,
      rule: 'valid-connections',
      message: `Edge "${edge.id}" references a non-existent node`,
    }));
}

export function validateRouterEdgeCount(graph: GraphDefinition): ValidationError[] {
  const routerNodes = graph.nodes.filter((n) => n.type === 'router');
  return routerNodes
    .filter((router) => {
      const outgoing = graph.edges.filter((e) => e.source === router.id);
      return outgoing.length < 2;
    })
    .map((router) => ({
      nodeId: router.id,
      rule: 'router-edge-count',
      message: `Router node "${router.id}" must have at least 2 outgoing edges`,
    }));
}

export function validateStateSchemaRequired(graph: GraphDefinition): ValidationError[] {
  const hasStateSchema = graph.nodes.some((n) => n.type === 'state-schema');
  if (!hasStateSchema) {
    return [{ rule: 'state-schema-required', message: 'Workflow agents require a State Schema node' }];
  }
  return [];
}

export function validateGraph(graph: GraphDefinition): ValidationError[] {
  return [
    ...validateNoOrphanNodes(graph),
    ...validateEntryNodeExists(graph),
    ...validateValidConnections(graph),
    ...validateRouterEdgeCount(graph),
    ...validateStateSchemaRequired(graph),
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd libs/agent-studio && bunx vitest run`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/agent-studio/src/validation/
git commit -m "feat(agent-studio): add graph validation rules with tests"
```

---

## Task 5: Prisma schema + RBAC updates

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `libs/shared/src/rbac/types.ts`
- Modify: `libs/shared/src/rbac/permissions.ts`

- [ ] **Step 1: Add Agent models to Prisma schema**

Add to `prisma/schema.prisma` after the `AuditLog` model:

```prisma
model Agent {
  id          String   @id @default(cuid())
  tenantId    String
  createdBy   String
  name        String
  description String?
  type        String
  status      String   @default("draft")
  tags        Json     @default("[]")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenant   Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  versions AgentVersion[]

  @@index([tenantId])
  @@index([tenantId, status])
  @@index([tenantId, createdBy])
  @@map("agents")
}

model AgentVersion {
  id          String    @id @default(cuid())
  agentId     String
  version     Int
  graphDef    Json?
  config      Json
  changelog   String?
  status      String    @default("draft")
  publishedAt DateTime?
  createdAt   DateTime  @default(now())

  agent      Agent            @relation(fields: [agentId], references: [id], onDelete: Cascade)
  executions AgentExecution[]

  @@unique([agentId, version])
  @@index([agentId])
  @@map("agent_versions")
}

model AgentExecution {
  id         String   @id @default(cuid())
  agentId    String
  versionId  String
  tenantId   String
  userId     String
  input      Json
  output     Json?
  status     String   @default("running")
  error      String?
  duration   Int?
  tokenUsage Json?
  createdAt  DateTime @default(now())

  version AgentVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@index([agentId])
  @@index([tenantId])
  @@index([tenantId, createdAt])
  @@map("agent_executions")
}
```

- [ ] **Step 2: Add `agents` relation to existing `Tenant` model**

In the `Tenant` model in `prisma/schema.prisma`, add after the `userRoles` relation:

```prisma
  agents        Agent[]
```

- [ ] **Step 3: Generate Prisma client and create migration**

Run: `bunx prisma migrate dev --name add-agent-studio-models --schema=./prisma/schema.prisma`

Expected: Migration created and applied successfully.

- [ ] **Step 4: Add `'Agents'` to RBAC Module type**

In `libs/shared/src/rbac/types.ts`, change:

```typescript
export type Module = 'Conversations' | 'Messages' | 'Settings' | 'Users' | 'Tenants';
```

to:

```typescript
export type Module = 'Conversations' | 'Messages' | 'Settings' | 'Users' | 'Tenants' | 'Agents';
```

Add to `SUBJECT_TO_MODULE`:

```typescript
  Agent: 'Agents',
```

- [ ] **Step 5: Add Agents permissions to RBAC**

In `libs/shared/src/rbac/permissions.ts`, add `Agents` to each role in `ROLE_PERMISSIONS`:

```typescript
Owner: {
  // ... existing
  Agents: ['create', 'read', 'update', 'delete'],
},
Admin: {
  // ... existing
  Agents: ['create', 'read', 'update', 'delete'],
},
Member: {
  // ... existing
  Agents: ['create', 'read', 'update'],
},
Viewer: {
  // ... existing
  Agents: ['read'],
},
```

- [ ] **Step 6: Run existing RBAC tests to verify no regressions**

Run: `nx test shared`

Expected: All existing tests PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma libs/shared/src/rbac/types.ts libs/shared/src/rbac/permissions.ts
git commit -m "feat(agent-studio): add Prisma models and RBAC permissions for agents"
```

---

## Task 6: AgentService + AgentVersionService with tests

**Files:**
- Create: `libs/agent-studio/src/services/agent-service.ts`
- Create: `libs/agent-studio/src/services/agent-service.test.ts`
- Create: `libs/agent-studio/src/services/agent-version-service.ts`
- Create: `libs/agent-studio/src/services/agent-version-service.test.ts`
- Create: `libs/agent-studio/src/services/graph-validation-service.ts`
- Create: `libs/agent-studio/src/services/graph-validation-service.test.ts`

- [ ] **Step 1: Write failing tests for AgentService**

Create `libs/agent-studio/src/services/agent-service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService } from './agent-service';

const mockPrisma = {
  agent: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  agentVersion: {
    create: vi.fn(),
  },
  $transaction: vi.fn((fn: any) => fn(mockPrisma)),
};

describe('AgentService', () => {
  let service: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentService(mockPrisma as any);
  });

  describe('createAgent', () => {
    it('creates agent with initial version', async () => {
      const agentData = { id: 'agent-1', name: 'Test Agent', type: 'workflow', status: 'draft', tags: [] };
      mockPrisma.agent.create.mockResolvedValue(agentData);
      mockPrisma.agentVersion.create.mockResolvedValue({ id: 'v1', agentId: 'agent-1', version: 1 });

      const result = await service.createAgent('tenant-1', 'user-1', {
        name: 'Test Agent',
        type: 'workflow',
      });

      expect(mockPrisma.agent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          createdBy: 'user-1',
          name: 'Test Agent',
          type: 'workflow',
        }),
      });
      expect(result).toEqual(agentData);
    });
  });

  describe('listAgents', () => {
    it('returns paginated agents', async () => {
      mockPrisma.agent.findMany.mockResolvedValue([{ id: 'a1', name: 'Agent 1' }]);
      mockPrisma.agent.count.mockResolvedValue(1);

      const result = await service.listAgents('tenant-1', { limit: 20, offset: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockPrisma.agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-1', status: { not: 'archived' } }),
          take: 20,
          skip: 0,
        }),
      );
    });

    it('filters by type', async () => {
      mockPrisma.agent.findMany.mockResolvedValue([]);
      mockPrisma.agent.count.mockResolvedValue(0);

      await service.listAgents('tenant-1', { type: 'simple', limit: 20, offset: 0 });

      expect(mockPrisma.agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'simple' }),
        }),
      );
    });
  });

  describe('getAgent', () => {
    it('returns agent with latest version', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue({
        id: 'a1',
        name: 'Agent',
        versions: [{ version: 2 }, { version: 1 }],
      });

      const result = await service.getAgent('a1');

      expect(result).toBeDefined();
      expect(mockPrisma.agent.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1' },
          include: expect.objectContaining({ versions: expect.any(Object) }),
        }),
      );
    });
  });

  describe('deleteAgent', () => {
    it('soft deletes by setting status to archived', async () => {
      mockPrisma.agent.update.mockResolvedValue({ id: 'a1', status: 'archived' });

      await service.deleteAgent('a1');

      expect(mockPrisma.agent.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { status: 'archived' },
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd libs/agent-studio && bunx vitest run src/services/agent-service.test.ts`

Expected: FAIL (module not found).

- [ ] **Step 3: Implement AgentService**

Create `libs/agent-studio/src/services/agent-service.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';
import type { AgentType, AgentFilters, CreateAgentInput, UpdateAgentInput } from '../types/agent';

export class AgentService {
  constructor(private readonly prisma: PrismaClient) {}

  async createAgent(tenantId: string, userId: string, input: CreateAgentInput) {
    const defaultConfig = input.type === 'simple'
      ? {
          model: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
          systemPrompt: '',
          temperature: 0.7,
          maxTokens: 4096,
          tools: [],
          memory: { contextWindowSize: 10 },
        }
      : {};

    return this.prisma.$transaction(async (tx: any) => {
      const agent = await tx.agent.create({
        data: {
          tenantId,
          createdBy: userId,
          name: input.name,
          description: input.description ?? null,
          type: input.type,
          tags: input.tags ?? [],
        },
      });

      await tx.agentVersion.create({
        data: {
          agentId: agent.id,
          version: 1,
          graphDef: input.type === 'workflow' ? { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } : null,
          config: defaultConfig,
        },
      });

      return agent;
    });
  }

  async listAgents(tenantId: string, filters: AgentFilters = {}) {
    const { type, status, search, limit = 20, offset = 0 } = filters;
    const where: any = { tenantId, status: status ?? { not: 'archived' } };
    if (type) where.type = type;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.agent.findMany({
        where,
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.agent.count({ where }),
    ]);

    return { items, total };
  }

  async getAgent(agentId: string) {
    return this.prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        versions: { orderBy: { version: 'desc' }, take: 1 },
      },
    });
  }

  async updateAgent(agentId: string, input: UpdateAgentInput) {
    return this.prisma.agent.update({
      where: { id: agentId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.tags !== undefined && { tags: input.tags }),
      },
    });
  }

  async deleteAgent(agentId: string) {
    return this.prisma.agent.update({
      where: { id: agentId },
      data: { status: 'archived' },
    });
  }
}
```

- [ ] **Step 4: Run AgentService tests**

Run: `cd libs/agent-studio && bunx vitest run src/services/agent-service.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Write failing tests for AgentVersionService**

Create `libs/agent-studio/src/services/agent-version-service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentVersionService } from './agent-version-service';

const mockPrisma = {
  agentVersion: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};

describe('AgentVersionService', () => {
  let service: AgentVersionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentVersionService(mockPrisma as any);
  });

  describe('saveVersion', () => {
    it('auto-increments version number', async () => {
      mockPrisma.agentVersion.findFirst.mockResolvedValue({ version: 3 });
      mockPrisma.agentVersion.create.mockResolvedValue({ id: 'v4', agentId: 'a1', version: 4 });

      const result = await service.saveVersion('a1', { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, {});

      expect(mockPrisma.agentVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ agentId: 'a1', version: 4 }),
      });
    });

    it('starts at version 1 when no versions exist', async () => {
      mockPrisma.agentVersion.findFirst.mockResolvedValue(null);
      mockPrisma.agentVersion.create.mockResolvedValue({ id: 'v1', agentId: 'a1', version: 1 });

      await service.saveVersion('a1', null, { model: { provider: 'anthropic', modelId: 'test' } });

      expect(mockPrisma.agentVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 1 }),
      });
    });
  });

  describe('publishVersion', () => {
    it('sets status to published and records timestamp', async () => {
      mockPrisma.agentVersion.findUnique.mockResolvedValue({ id: 'v1', agentId: 'a1', version: 1 });
      mockPrisma.agentVersion.update.mockResolvedValue({ id: 'v1', status: 'published' });

      await service.publishVersion('a1', 1);

      expect(mockPrisma.agentVersion.update).toHaveBeenCalledWith({
        where: { agentId_version: { agentId: 'a1', version: 1 } },
        data: expect.objectContaining({ status: 'published', publishedAt: expect.any(Date) }),
      });
    });
  });

  describe('listVersions', () => {
    it('returns all versions ordered by version desc', async () => {
      mockPrisma.agentVersion.findMany.mockResolvedValue([{ version: 2 }, { version: 1 }]);

      const result = await service.listVersions('a1');

      expect(result).toHaveLength(2);
      expect(mockPrisma.agentVersion.findMany).toHaveBeenCalledWith({
        where: { agentId: 'a1' },
        orderBy: { version: 'desc' },
      });
    });
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd libs/agent-studio && bunx vitest run src/services/agent-version-service.test.ts`

Expected: FAIL.

- [ ] **Step 7: Implement AgentVersionService**

Create `libs/agent-studio/src/services/agent-version-service.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';
import type { GraphDefinition } from '../types/agent';

export class AgentVersionService {
  constructor(private readonly prisma: PrismaClient) {}

  async saveVersion(agentId: string, graphDef: GraphDefinition | null, config: Record<string, unknown>) {
    const latest = await this.prisma.agentVersion.findFirst({
      where: { agentId },
      orderBy: { version: 'desc' },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    return this.prisma.agentVersion.create({
      data: {
        agentId,
        version: nextVersion,
        graphDef: graphDef as any,
        config: config as any,
      },
    });
  }

  async getVersion(agentId: string, version: number) {
    return this.prisma.agentVersion.findUnique({
      where: { agentId_version: { agentId, version } },
    });
  }

  async listVersions(agentId: string) {
    return this.prisma.agentVersion.findMany({
      where: { agentId },
      orderBy: { version: 'desc' },
    });
  }

  async publishVersion(agentId: string, version: number) {
    return this.prisma.agentVersion.update({
      where: { agentId_version: { agentId, version } },
      data: { status: 'published', publishedAt: new Date() },
    });
  }

  async diffVersions(agentId: string, v1: number, v2: number) {
    const [version1, version2] = await Promise.all([
      this.getVersion(agentId, v1),
      this.getVersion(agentId, v2),
    ]);
    if (!version1 || !version2) return null;
    return {
      graphDef: { before: version1.graphDef, after: version2.graphDef },
      config: { before: version1.config, after: version2.config },
    };
  }
}
```

- [ ] **Step 8: Run all version service tests**

Run: `cd libs/agent-studio && bunx vitest run src/services/agent-version-service.test.ts`

Expected: All tests PASS.

- [ ] **Step 9: Create GraphValidationService**

Create `libs/agent-studio/src/services/graph-validation-service.ts`:

```typescript
import type { GraphDefinition } from '../types/agent';
import type { ValidationError } from '../types/nodes';
import { validateGraph } from '../validation/rules';

export class GraphValidationService {
  validate(graph: GraphDefinition): ValidationError[] {
    return validateGraph(graph);
  }
}
```

Create `libs/agent-studio/src/services/graph-validation-service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { GraphValidationService } from './graph-validation-service';
import type { GraphDefinition } from '../types/agent';

describe('GraphValidationService', () => {
  const service = new GraphValidationService();

  it('returns no errors for a valid graph', () => {
    const graph: GraphDefinition = {
      nodes: [
        { id: 'n1', type: 'state-schema', position: { x: 0, y: 0 }, data: { nodeType: 'state-schema', fields: [{ name: 'messages', type: 'array' }] } as any },
        { id: 'n2', type: 'llm', position: { x: 0, y: 100 }, data: { nodeType: 'llm' } as any },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    expect(service.validate(graph)).toEqual([]);
  });

  it('returns multiple errors for an invalid graph', () => {
    const graph: GraphDefinition = {
      nodes: [
        { id: 'n1', type: 'llm', position: { x: 0, y: 0 }, data: { nodeType: 'llm' } as any },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n999' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const errors = service.validate(graph);
    expect(errors.length).toBeGreaterThan(0);
    const rules = errors.map((e) => e.rule);
    expect(rules).toContain('valid-connections');
    expect(rules).toContain('state-schema-required');
  });
});
```

- [ ] **Step 10: Run all agent-studio tests**

Run: `cd libs/agent-studio && bunx vitest run`

Expected: All tests PASS.

- [ ] **Step 11: Commit**

```bash
git add libs/agent-studio/src/services/
git commit -m "feat(agent-studio): add AgentService, AgentVersionService, GraphValidationService with tests"
```

---

## Task 7: API routes for agents

**Files:**
- Create: `apps/web-ui/app/api/agents/route.ts`
- Create: `apps/web-ui/app/api/agents/[id]/route.ts`
- Create: `apps/web-ui/app/api/agents/[id]/versions/route.ts`
- Create: `apps/web-ui/app/api/agents/[id]/versions/[version]/route.ts`
- Create: `apps/web-ui/app/api/agents/[id]/versions/[version]/publish/route.ts`
- Create: `apps/web-ui/app/api/agents/[id]/validate/route.ts`

- [ ] **Step 1: Create `apps/web-ui/app/api/agents/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, AuditService } from '@chatbot/shared';
import { AgentService } from '@chatbot/agent-studio';
import { getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);
    const type = searchParams.get('type') as 'simple' | 'workflow' | null;
    const search = searchParams.get('search') ?? undefined;

    const service = new AgentService(getPrismaClient());
    const result = await service.listAgents(tenantId, { limit, offset, type: type ?? undefined, search });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);
    const authError = await authorize('create', 'Agent', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const service = new AgentService(getPrismaClient());
    const agent = await service.createAgent(tenantId, userId, body);

    AuditService.logUserAction({
      eventType: 'agent.created',
      action: 'Created Agent',
      resourceType: 'agent',
      resourceId: agent.id,
      resourceName: agent.name,
      user: userId,
      userType: 'user',
      status: 'success',
      severity: 'low',
      details: `Created ${body.type} agent "${agent.name}"`,
      tenantId,
    }).catch(() => {});

    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create `apps/web-ui/app/api/agents/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { AgentService } from '@chatbot/agent-studio';
import { getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const service = new AgentService(getPrismaClient());
    const agent = await service.getAgent(id);
    if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json(agent);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const service = new AgentService(getPrismaClient());
    const agent = await service.updateAgent(id, body);

    return NextResponse.json(agent);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'Agent', authOptions);
    if (authError) return authError;

    const service = new AgentService(getPrismaClient());
    await service.deleteAgent(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create `apps/web-ui/app/api/agents/[id]/versions/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { AgentVersionService, GraphValidationService } from '@chatbot/agent-studio';
import { getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const service = new AgentVersionService(getPrismaClient());
    const versions = await service.listVersions(id);

    return NextResponse.json(versions);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { graphDef, config } = await req.json();

    const validationService = new GraphValidationService();
    const validationErrors = graphDef ? validationService.validate(graphDef) : [];

    const versionService = new AgentVersionService(getPrismaClient());
    const version = await versionService.saveVersion(id, graphDef ?? null, config ?? {});

    return NextResponse.json({ version, validationErrors }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Create `apps/web-ui/app/api/agents/[id]/versions/[version]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { AgentVersionService } from '@chatbot/agent-studio';
import { getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  try {
    const { id, version: versionStr } = await params;
    await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const service = new AgentVersionService(getPrismaClient());
    const version = await service.getVersion(id, parseInt(versionStr, 10));
    if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json(version);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Create `apps/web-ui/app/api/agents/[id]/versions/[version]/publish/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, getSessionUserId, authorize, AuditService } from '@chatbot/shared';
import { AgentVersionService } from '@chatbot/agent-studio';
import { getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  try {
    const { id, version: versionStr } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);

    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const service = new AgentVersionService(getPrismaClient());
    const version = await service.publishVersion(id, parseInt(versionStr, 10));

    AuditService.logUserAction({
      eventType: 'agent.version.published',
      action: 'Published Agent Version',
      resourceType: 'agent',
      resourceId: id,
      resourceName: `v${versionStr}`,
      user: userId,
      userType: 'user',
      status: 'success',
      severity: 'medium',
      details: `Published agent version ${versionStr}`,
      tenantId,
    }).catch(() => {});

    return NextResponse.json(version);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 6: Create `apps/web-ui/app/api/agents/[id]/validate/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize } from '@chatbot/shared';
import { GraphValidationService } from '@chatbot/agent-studio';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const { graphDef } = await req.json();
    const service = new GraphValidationService();
    const errors = service.validate(graphDef);

    return NextResponse.json({ valid: errors.length === 0, errors });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 7: Verify build compiles**

Run: `nx build web-ui`

Expected: Build succeeds (or at least no TypeScript errors in the new API routes).

- [ ] **Step 8: Commit**

```bash
git add apps/web-ui/app/api/agents/
git commit -m "feat(agent-studio): add API routes for agent CRUD, versioning, publishing, and validation"
```

---

## Task 8: Sidebar navigation + agent list page

**Files:**
- Modify: `apps/web-ui/components/app-sidebar.tsx`
- Create: `apps/web-ui/app/(dashboard)/agents/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/agents/layout.tsx`
- Create: `apps/web-ui/components/agent-studio/agent-list.tsx`
- Create: `apps/web-ui/components/agent-studio/create-agent-dialog.tsx`

- [ ] **Step 1: Add Agent Studio to sidebar**

In `apps/web-ui/components/app-sidebar.tsx`, add to the `navMain` array after the first item:

```typescript
{
  title: "Agent Studio",
  url: "/agents",
  icon: (
    <BotIcon />
  ),
  isActive: false,
  items: [
    {
      title: "All Agents",
      url: "/agents",
    },
  ],
},
```

Note: `BotIcon` is already imported in the file.

- [ ] **Step 2: Create `apps/web-ui/app/(dashboard)/agents/layout.tsx`**

```typescript
export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

- [ ] **Step 3: Create `apps/web-ui/components/agent-studio/create-agent-dialog.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusIcon } from 'lucide-react';

interface CreateAgentDialogProps {
  onCreated: (agent: any) => void;
}

export function CreateAgentDialog({ onCreated }: CreateAgentDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'simple' | 'workflow'>('workflow');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || undefined, type }),
      });
      if (!res.ok) throw new Error('Failed to create agent');
      const agent = await res.json();
      onCreated(agent);
      setOpen(false);
      setName('');
      setDescription('');
      setType('workflow');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon className="mr-2 h-4 w-4" />
          Create Agent
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Agent</DialogTitle>
            <DialogDescription>
              Choose a type and give your agent a name.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="agent-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as 'simple' | 'workflow')}>
                <SelectTrigger id="agent-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="simple">Simple (Chatbot)</SelectItem>
                  <SelectItem value="workflow">Workflow (Canvas)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="agent-name">Name</Label>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Agent"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="agent-desc">Description (optional)</Label>
              <Textarea
                id="agent-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this agent do?"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Create `apps/web-ui/components/agent-studio/agent-list.tsx`**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BotIcon, WorkflowIcon } from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  description?: string;
  type: 'simple' | 'workflow';
  status: string;
  updatedAt: string;
  versions?: { version: number }[];
}

interface AgentListProps {
  agents: Agent[];
}

export function AgentList({ agents }: AgentListProps) {
  const router = useRouter();

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <BotIcon className="mb-4 h-12 w-12" />
        <p className="text-lg font-medium">No agents yet</p>
        <p className="text-sm">Create your first agent to get started.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {agents.map((agent) => (
        <Card
          key={agent.id}
          className="cursor-pointer transition-colors hover:bg-muted/50"
          onClick={() => router.push(`/agents/${agent.id}`)}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{agent.name}</CardTitle>
              <Badge variant={agent.type === 'workflow' ? 'default' : 'secondary'}>
                {agent.type === 'workflow' ? (
                  <><WorkflowIcon className="mr-1 h-3 w-3" /> Workflow</>
                ) : (
                  <><BotIcon className="mr-1 h-3 w-3" /> Simple</>
                )}
              </Badge>
            </div>
            {agent.description && (
              <CardDescription className="line-clamp-2">{agent.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>v{agent.versions?.[0]?.version ?? 1}</span>
              <Badge variant="outline" className="text-xs">
                {agent.status}
              </Badge>
              <span>{new Date(agent.updatedAt).toLocaleDateString()}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Create `apps/web-ui/app/(dashboard)/agents/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AgentList } from '@/components/agent-studio/agent-list';
import { CreateAgentDialog } from '@/components/agent-studio/create-agent-dialog';

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAgents = async () => {
    try {
      const res = await fetch('/api/agents');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setAgents(data.items ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAgents(); }, []);

  const handleCreated = (agent: any) => {
    router.push(`/agents/${agent.id}`);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agent Studio</h1>
          <p className="text-muted-foreground">Build and manage your AI agents.</p>
        </div>
        <CreateAgentDialog onCreated={handleCreated} />
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">Loading...</div>
      ) : (
        <AgentList agents={agents} />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Verify the page renders**

Run: `bun run dev`

Navigate to `http://localhost:3001/agents`. Expected: Agent Studio page renders with "No agents yet" empty state and a "Create Agent" button.

- [ ] **Step 7: Commit**

```bash
git add apps/web-ui/components/app-sidebar.tsx apps/web-ui/app/\(dashboard\)/agents/ apps/web-ui/components/agent-studio/agent-list.tsx apps/web-ui/components/agent-studio/create-agent-dialog.tsx
git commit -m "feat(agent-studio): add sidebar nav, agent list page, and create agent dialog"
```

---

## Task 9: Install dependencies + Zustand store + TanStack Query hooks

**Files:**
- Create: `apps/web-ui/stores/agent-canvas-store.ts`
- Create: `apps/web-ui/hooks/use-agents.ts`
- Create: `apps/web-ui/hooks/use-agent-versions.ts`

- [ ] **Step 1: Install React Flow and Monaco Editor**

Run: `bun add @xyflow/react @monaco-editor/react @tanstack/react-query zustand`

Note: `@tanstack/react-query` may already be installed — check `node_modules` first. `zustand` may also already be present.

- [ ] **Step 2: Create Zustand store `apps/web-ui/stores/agent-canvas-store.ts`**

```typescript
import { create } from 'zustand';
import type { Node, Edge, Viewport, NodeChange, EdgeChange, Connection, addEdge, applyNodeChanges, applyEdgeChanges } from '@xyflow/react';

interface CanvasHistoryEntry {
  nodes: Node[];
  edges: Edge[];
}

interface AgentCanvasState {
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
  selectedNodeId: string | null;
  isDirty: boolean;
  validationErrors: { nodeId?: string; edgeId?: string; rule: string; message: string }[];
  history: CanvasHistoryEntry[];
  historyIndex: number;

  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  setViewport: (viewport: Viewport) => void;
  setSelectedNodeId: (id: string | null) => void;
  setValidationErrors: (errors: AgentCanvasState['validationErrors']) => void;
  setIsDirty: (dirty: boolean) => void;

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  addNode: (node: Node) => void;
  removeNode: (id: string) => void;
  updateNodeData: (id: string, data: Record<string, unknown>) => void;

  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  loadGraph: (nodes: Node[], edges: Edge[], viewport: Viewport) => void;
  reset: () => void;
}

export const useAgentCanvasStore = create<AgentCanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedNodeId: null,
  isDirty: false,
  validationErrors: [],
  history: [],
  historyIndex: -1,

  setNodes: (nodes) => set({ nodes, isDirty: true }),
  setEdges: (edges) => set({ edges, isDirty: true }),
  setViewport: (viewport) => set({ viewport }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setValidationErrors: (errors) => set({ validationErrors: errors }),
  setIsDirty: (dirty) => set({ isDirty: dirty }),

  onNodesChange: (changes) => {
    const { applyNodeChanges } = require('@xyflow/react');
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
      isDirty: true,
    }));
  },

  onEdgesChange: (changes) => {
    const { applyEdgeChanges } = require('@xyflow/react');
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      isDirty: true,
    }));
  },

  onConnect: (connection) => {
    const { addEdge } = require('@xyflow/react');
    set((state) => ({
      edges: addEdge({ ...connection, id: `e-${Date.now()}` }, state.edges),
      isDirty: true,
    }));
  },

  addNode: (node) => {
    get().pushHistory();
    set((state) => ({ nodes: [...state.nodes, node], isDirty: true }));
  },

  removeNode: (id) => {
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      isDirty: true,
    }));
  },

  updateNodeData: (id, data) => {
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
      isDirty: true,
    }));
  },

  pushHistory: () => {
    const { nodes, edges, history, historyIndex } = get();
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ nodes: structuredClone(nodes), edges: structuredClone(edges) });
    if (newHistory.length > 50) newHistory.shift();
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },

  undo: () => {
    const { historyIndex, history } = get();
    if (historyIndex < 0) return;
    const entry = history[historyIndex];
    set({ nodes: entry.nodes, edges: entry.edges, historyIndex: historyIndex - 1, isDirty: true });
  },

  redo: () => {
    const { historyIndex, history } = get();
    if (historyIndex >= history.length - 1) return;
    const entry = history[historyIndex + 1];
    set({ nodes: entry.nodes, edges: entry.edges, historyIndex: historyIndex + 1, isDirty: true });
  },

  loadGraph: (nodes, edges, viewport) => {
    set({ nodes, edges, viewport, isDirty: false, history: [], historyIndex: -1, validationErrors: [] });
  },

  reset: () => {
    set({
      nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
      selectedNodeId: null, isDirty: false, validationErrors: [],
      history: [], historyIndex: -1,
    });
  },
}));
```

- [ ] **Step 3: Create TanStack Query hooks `apps/web-ui/hooks/use-agents.ts`**

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface AgentFilters {
  type?: 'simple' | 'workflow';
  search?: string;
  limit?: number;
  offset?: number;
}

export function useAgents(filters: AgentFilters = {}) {
  const params = new URLSearchParams();
  if (filters.type) params.set('type', filters.type);
  if (filters.search) params.set('search', filters.search);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));

  return useQuery({
    queryKey: ['agents', filters],
    queryFn: async () => {
      const res = await fetch(`/api/agents?${params}`);
      if (!res.ok) throw new Error('Failed to fetch agents');
      return res.json();
    },
  });
}

export function useAgent(id: string | null) {
  return useQuery({
    queryKey: ['agent', id],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${id}`);
      if (!res.ok) throw new Error('Failed to fetch agent');
      return res.json();
    },
    enabled: !!id,
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; type: 'simple' | 'workflow'; description?: string }) => {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create agent');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; description?: string; tags?: string[] }) => {
      const res = await fetch(`/api/agents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update agent');
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agent', vars.id] });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete agent');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });
}
```

- [ ] **Step 4: Create TanStack Query hooks `apps/web-ui/hooks/use-agent-versions.ts`**

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function useAgentVersions(agentId: string | null) {
  return useQuery({
    queryKey: ['agent-versions', agentId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${agentId}/versions`);
      if (!res.ok) throw new Error('Failed to fetch versions');
      return res.json();
    },
    enabled: !!agentId,
  });
}

export function useSaveVersion(agentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { graphDef?: any; config?: any }) => {
      const res = await fetch(`/api/agents/${agentId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to save version');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-versions', agentId] });
      queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
    },
  });
}

export function usePublishVersion(agentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (version: number) => {
      const res = await fetch(`/api/agents/${agentId}/versions/${version}/publish`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to publish version');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-versions', agentId] });
      queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
    },
  });
}

export function useValidateGraph(agentId: string | null) {
  return useMutation({
    mutationFn: async (graphDef: any) => {
      const res = await fetch(`/api/agents/${agentId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graphDef }),
      });
      if (!res.ok) throw new Error('Failed to validate');
      return res.json();
    },
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/stores/agent-canvas-store.ts apps/web-ui/hooks/use-agents.ts apps/web-ui/hooks/use-agent-versions.ts
git commit -m "feat(agent-studio): add Zustand canvas store and TanStack Query hooks"
```

---

## Task 10: Custom React Flow node components

**Files:**
- Create: `apps/web-ui/components/agent-studio/nodes/llm-node.tsx`
- Create: `apps/web-ui/components/agent-studio/nodes/tool-node.tsx`
- Create: `apps/web-ui/components/agent-studio/nodes/router-node.tsx`
- Create: `apps/web-ui/components/agent-studio/nodes/state-schema-node.tsx`
- Create: `apps/web-ui/components/agent-studio/nodes/node-types.ts`

- [ ] **Step 1: Create `apps/web-ui/components/agent-studio/nodes/llm-node.tsx`**

```tsx
'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { BrainIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

function LlmNodeComponent({ data, selected }: NodeProps) {
  const config = data as any;
  return (
    <div
      className={`rounded-lg border-2 bg-card px-4 py-3 shadow-sm transition-colors ${
        selected ? 'border-blue-500' : 'border-blue-200'
      }`}
      style={{ minWidth: 200 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-blue-500" />
      <div className="flex items-center gap-2 mb-2">
        <BrainIcon className="h-4 w-4 text-blue-500" />
        <span className="text-sm font-medium">LLM</span>
        {config.temperature !== undefined && (
          <Badge variant="outline" className="ml-auto text-xs">
            t={config.temperature}
          </Badge>
        )}
      </div>
      {config.modelId && (
        <p className="text-xs text-muted-foreground truncate">{config.modelId}</p>
      )}
      {config.systemPrompt && (
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2 italic">
          {config.systemPrompt}
        </p>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-blue-500" />
    </div>
  );
}

export const LlmNode = memo(LlmNodeComponent);
```

- [ ] **Step 2: Create `apps/web-ui/components/agent-studio/nodes/tool-node.tsx`**

```tsx
'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { WrenchIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

function ToolNodeComponent({ data, selected }: NodeProps) {
  const config = data as any;
  const toolCount = config.tools?.length ?? 0;
  const toolNames = config.tools?.map((t: any) => t.name).filter(Boolean).join(', ');

  return (
    <div
      className={`rounded-lg border-2 bg-card px-4 py-3 shadow-sm transition-colors ${
        selected ? 'border-green-500' : 'border-green-200'
      }`}
      style={{ minWidth: 180 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-green-500" />
      <div className="flex items-center gap-2 mb-1">
        <WrenchIcon className="h-4 w-4 text-green-500" />
        <span className="text-sm font-medium">Tool</span>
        <Badge variant="outline" className="ml-auto text-xs">{toolCount}</Badge>
      </div>
      {toolNames && (
        <p className="text-xs text-muted-foreground truncate">{toolNames}</p>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-green-500" />
    </div>
  );
}

export const ToolNode = memo(ToolNodeComponent);
```

- [ ] **Step 3: Create `apps/web-ui/components/agent-studio/nodes/router-node.tsx`**

```tsx
'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GitBranchIcon } from 'lucide-react';

function RouterNodeComponent({ data, selected }: NodeProps) {
  const config = data as any;

  return (
    <div
      className={`rounded-lg border-2 bg-card px-4 py-3 shadow-sm transition-colors ${
        selected ? 'border-orange-500' : 'border-orange-200'
      }`}
      style={{ minWidth: 160, transform: 'rotate(0deg)' }}
    >
      <Handle type="target" position={Position.Top} className="!bg-orange-500" />
      <div className="flex items-center gap-2 mb-1">
        <GitBranchIcon className="h-4 w-4 text-orange-500" />
        <span className="text-sm font-medium">Router</span>
      </div>
      {config.condition && (
        <p className="text-xs text-muted-foreground line-clamp-2">{config.condition}</p>
      )}
      <Handle type="source" position={Position.Bottom} id="true" className="!bg-orange-500 !left-1/3" />
      <Handle type="source" position={Position.Bottom} id="false" className="!bg-orange-500 !left-2/3" />
    </div>
  );
}

export const RouterNode = memo(RouterNodeComponent);
```

- [ ] **Step 4: Create `apps/web-ui/components/agent-studio/nodes/state-schema-node.tsx`**

```tsx
'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { DatabaseIcon } from 'lucide-react';

function StateSchemaNodeComponent({ data, selected }: NodeProps) {
  const config = data as any;
  const fields = config.fields ?? [];

  return (
    <div
      className={`rounded-lg border-2 bg-card px-4 py-3 shadow-sm transition-colors ${
        selected ? 'border-purple-500' : 'border-purple-200'
      }`}
      style={{ minWidth: 180 }}
    >
      <div className="flex items-center gap-2 mb-2">
        <DatabaseIcon className="h-4 w-4 text-purple-500" />
        <span className="text-sm font-medium">State Schema</span>
      </div>
      {fields.length > 0 && (
        <div className="space-y-0.5">
          {fields.slice(0, 5).map((f: any) => (
            <p key={f.name} className="text-xs text-muted-foreground">
              <span className="font-mono">{f.name}</span>: <span className="text-purple-500">{f.type}</span>
            </p>
          ))}
          {fields.length > 5 && (
            <p className="text-xs text-muted-foreground">+{fields.length - 5} more</p>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-purple-500" />
    </div>
  );
}

export const StateSchemaNode = memo(StateSchemaNodeComponent);
```

- [ ] **Step 5: Create `apps/web-ui/components/agent-studio/nodes/node-types.ts`**

```typescript
import { LlmNode } from './llm-node';
import { ToolNode } from './tool-node';
import { RouterNode } from './router-node';
import { StateSchemaNode } from './state-schema-node';

export const nodeTypes = {
  llm: LlmNode,
  tool: ToolNode,
  router: RouterNode,
  'state-schema': StateSchemaNode,
};
```

- [ ] **Step 6: Commit**

```bash
git add apps/web-ui/components/agent-studio/nodes/
git commit -m "feat(agent-studio): add custom React Flow node components for LLM, Tool, Router, State Schema"
```

---

## Task 11: Node config forms + config panel

**Files:**
- Create: `apps/web-ui/components/agent-studio/forms/llm-config-form.tsx`
- Create: `apps/web-ui/components/agent-studio/forms/tool-config-form.tsx`
- Create: `apps/web-ui/components/agent-studio/forms/router-config-form.tsx`
- Create: `apps/web-ui/components/agent-studio/forms/state-schema-form.tsx`
- Create: `apps/web-ui/components/agent-studio/forms/simple-agent-form.tsx`
- Create: `apps/web-ui/components/agent-studio/canvas/config-panel.tsx`

- [ ] **Step 1: Create LLM config form**

Create `apps/web-ui/components/agent-studio/forms/llm-config-form.tsx`:

```tsx
'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'bedrock', label: 'AWS Bedrock' },
  { value: 'ollama', label: 'Ollama' },
];

interface LlmConfigFormProps {
  config: any;
  onChange: (config: any) => void;
}

export function LlmConfigForm({ config, onChange }: LlmConfigFormProps) {
  const update = (key: string, value: unknown) => onChange({ ...config, [key]: value });

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Provider</Label>
        <Select value={config.provider ?? ''} onValueChange={(v) => update('provider', v)}>
          <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Model ID</Label>
        <Input value={config.modelId ?? ''} onChange={(e) => update('modelId', e.target.value)} placeholder="claude-sonnet-4-20250514" />
      </div>
      <div className="grid gap-2">
        <Label>Temperature: {config.temperature ?? 0.7}</Label>
        <Slider min={0} max={2} step={0.1} value={[config.temperature ?? 0.7]} onValueChange={([v]) => update('temperature', v)} />
      </div>
      <div className="grid gap-2">
        <Label>Max Tokens</Label>
        <Input type="number" value={config.maxTokens ?? 4096} onChange={(e) => update('maxTokens', parseInt(e.target.value, 10))} />
      </div>
      <div className="grid gap-2">
        <Label>System Prompt</Label>
        <Textarea value={config.systemPrompt ?? ''} onChange={(e) => update('systemPrompt', e.target.value)} rows={4} placeholder="You are a helpful assistant..." />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create Tool config form**

Create `apps/web-ui/components/agent-studio/forms/tool-config-form.tsx`:

```tsx
'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { PlusIcon, TrashIcon } from 'lucide-react';

interface ToolConfigFormProps {
  config: any;
  onChange: (config: any) => void;
}

export function ToolConfigForm({ config, onChange }: ToolConfigFormProps) {
  const tools = config.tools ?? [{ name: '', description: '', parameters: {} }];

  const updateTool = (index: number, key: string, value: unknown) => {
    const updated = tools.map((t: any, i: number) => (i === index ? { ...t, [key]: value } : t));
    onChange({ ...config, tools: updated });
  };

  const addTool = () => onChange({ ...config, tools: [...tools, { name: '', description: '', parameters: {} }] });

  const removeTool = (index: number) => {
    if (tools.length <= 1) return;
    onChange({ ...config, tools: tools.filter((_: any, i: number) => i !== index) });
  };

  return (
    <div className="space-y-4">
      {tools.map((tool: any, i: number) => (
        <div key={i} className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Tool {i + 1}</Label>
            {tools.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => removeTool(i)}>
                <TrashIcon className="h-3 w-3" />
              </Button>
            )}
          </div>
          <Input value={tool.name} onChange={(e) => updateTool(i, 'name', e.target.value)} placeholder="Tool name" />
          <Textarea value={tool.description} onChange={(e) => updateTool(i, 'description', e.target.value)} placeholder="Description" rows={2} />
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addTool} className="w-full">
        <PlusIcon className="mr-1 h-3 w-3" /> Add Tool
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Create Router config form**

Create `apps/web-ui/components/agent-studio/forms/router-config-form.tsx`:

```tsx
'use client';

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface RouterConfigFormProps {
  config: any;
  onChange: (config: any) => void;
}

export function RouterConfigForm({ config, onChange }: RouterConfigFormProps) {
  const update = (key: string, value: unknown) => onChange({ ...config, [key]: value });

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Condition Type</Label>
        <Select value={config.conditionType ?? 'natural-language'} onValueChange={(v) => update('conditionType', v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="natural-language">Natural Language</SelectItem>
            <SelectItem value="code">Code</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>{config.conditionType === 'code' ? 'Code' : 'Condition'}</Label>
        <Textarea
          value={config.condition ?? ''}
          onChange={(e) => update('condition', e.target.value)}
          rows={4}
          placeholder={config.conditionType === 'code' ? '(state) => state.needsReview ? "review" : "done"' : 'Route to review if the response needs human approval'}
          className={config.conditionType === 'code' ? 'font-mono text-xs' : ''}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create State Schema config form**

Create `apps/web-ui/components/agent-studio/forms/state-schema-form.tsx`:

```tsx
'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusIcon, TrashIcon } from 'lucide-react';

const FIELD_TYPES = ['string', 'number', 'boolean', 'array', 'object'] as const;

interface StateSchemaFormProps {
  config: any;
  onChange: (config: any) => void;
}

export function StateSchemaForm({ config, onChange }: StateSchemaFormProps) {
  const fields = config.fields ?? [{ name: 'messages', type: 'array' }];

  const updateField = (index: number, key: string, value: unknown) => {
    const updated = fields.map((f: any, i: number) => (i === index ? { ...f, [key]: value } : f));
    onChange({ ...config, fields: updated });
  };

  const addField = () => onChange({ ...config, fields: [...fields, { name: '', type: 'string' }] });

  const removeField = (index: number) => {
    if (fields.length <= 1) return;
    onChange({ ...config, fields: fields.filter((_: any, i: number) => i !== index) });
  };

  return (
    <div className="space-y-3">
      <Label>Fields</Label>
      {fields.map((field: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <Input value={field.name} onChange={(e) => updateField(i, 'name', e.target.value)} placeholder="Field name" className="flex-1" />
          <Select value={field.type} onValueChange={(v) => updateField(i, 'type', v)}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          {fields.length > 1 && (
            <Button variant="ghost" size="sm" onClick={() => removeField(i)}>
              <TrashIcon className="h-3 w-3" />
            </Button>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addField} className="w-full">
        <PlusIcon className="mr-1 h-3 w-3" /> Add Field
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Create config panel**

Create `apps/web-ui/components/agent-studio/canvas/config-panel.tsx`:

```tsx
'use client';

import { useAgentCanvasStore } from '@/stores/agent-canvas-store';
import { LlmConfigForm } from '../forms/llm-config-form';
import { ToolConfigForm } from '../forms/tool-config-form';
import { RouterConfigForm } from '../forms/router-config-form';
import { StateSchemaForm } from '../forms/state-schema-form';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { TrashIcon } from 'lucide-react';

export function ConfigPanel() {
  const { nodes, selectedNodeId, updateNodeData, removeNode } = useAgentCanvasStore();
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        Select a node to configure
      </div>
    );
  }

  const handleChange = (newData: any) => {
    updateNodeData(selectedNode.id, newData);
  };

  const renderForm = () => {
    switch (selectedNode.type) {
      case 'llm':
        return <LlmConfigForm config={selectedNode.data} onChange={handleChange} />;
      case 'tool':
        return <ToolConfigForm config={selectedNode.data} onChange={handleChange} />;
      case 'router':
        return <RouterConfigForm config={selectedNode.data} onChange={handleChange} />;
      case 'state-schema':
        return <StateSchemaForm config={selectedNode.data} onChange={handleChange} />;
      default:
        return <p className="text-sm text-muted-foreground">Unknown node type</p>;
    }
  };

  return (
    <div className="flex h-full flex-col border-l">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-medium capitalize">{selectedNode.type} Config</h3>
        <Button variant="ghost" size="sm" onClick={() => removeNode(selectedNode.id)}>
          <TrashIcon className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      <ScrollArea className="flex-1 p-4">
        {renderForm()}
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web-ui/components/agent-studio/forms/ apps/web-ui/components/agent-studio/canvas/config-panel.tsx
git commit -m "feat(agent-studio): add node config forms and config panel"
```

---

## Task 12: Canvas page — node palette, toolbar, status bar, main canvas

**Files:**
- Create: `apps/web-ui/components/agent-studio/canvas/node-palette.tsx`
- Create: `apps/web-ui/components/agent-studio/canvas/canvas-toolbar.tsx`
- Create: `apps/web-ui/components/agent-studio/canvas/canvas-status-bar.tsx`
- Create: `apps/web-ui/components/agent-studio/canvas/agent-canvas.tsx`

- [ ] **Step 1: Create node palette (left sidebar)**

Create `apps/web-ui/components/agent-studio/canvas/node-palette.tsx`:

```tsx
'use client';

import { BrainIcon, WrenchIcon, GitBranchIcon, DatabaseIcon } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

const NODE_TYPES = [
  { type: 'llm', label: 'LLM', icon: BrainIcon, category: 'AI', color: 'text-blue-500' },
  { type: 'tool', label: 'Tool', icon: WrenchIcon, category: 'AI', color: 'text-green-500' },
  { type: 'router', label: 'Router', icon: GitBranchIcon, category: 'Logic', color: 'text-orange-500' },
  { type: 'state-schema', label: 'State Schema', icon: DatabaseIcon, category: 'Data', color: 'text-purple-500' },
];

interface NodePaletteProps {
  onAddNode: (type: string) => void;
}

export function NodePalette({ onAddNode }: NodePaletteProps) {
  const categories = [...new Set(NODE_TYPES.map((n) => n.category))];

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="flex h-full w-48 flex-col border-r bg-muted/30">
      <div className="border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Nodes</h3>
      </div>
      <ScrollArea className="flex-1 p-2">
        {categories.map((cat) => (
          <div key={cat} className="mb-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-foreground">{cat}</p>
            {NODE_TYPES.filter((n) => n.category === cat).map((node) => (
              <div
                key={node.type}
                className="mb-1 flex cursor-grab items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent active:cursor-grabbing"
                draggable
                onDragStart={(e) => onDragStart(e, node.type)}
                onClick={() => onAddNode(node.type)}
              >
                <node.icon className={`h-4 w-4 ${node.color}`} />
                <span>{node.label}</span>
              </div>
            ))}
          </div>
        ))}
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 2: Create canvas toolbar (top bar)**

Create `apps/web-ui/components/agent-studio/canvas/canvas-toolbar.tsx`:

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Undo2Icon, Redo2Icon, SaveIcon, RocketIcon } from 'lucide-react';
import { useAgentCanvasStore } from '@/stores/agent-canvas-store';

interface CanvasToolbarProps {
  agentName: string;
  version: number;
  isSaving: boolean;
  onSave: () => void;
  onPublish: () => void;
}

export function CanvasToolbar({ agentName, version, isSaving, onSave, onPublish }: CanvasToolbarProps) {
  const { undo, redo, isDirty, historyIndex, history } = useAgentCanvasStore();

  return (
    <div className="flex items-center justify-between border-b bg-background px-4 py-2">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">{agentName}</h2>
        <Badge variant="outline" className="text-xs">v{version}</Badge>
        {isDirty && <Badge variant="secondary" className="text-xs">Unsaved</Badge>}
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={undo} disabled={historyIndex < 0} title="Undo">
          <Undo2Icon className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={redo} disabled={historyIndex >= history.length - 1} title="Redo">
          <Redo2Icon className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={onSave} disabled={isSaving || !isDirty}>
          <SaveIcon className="mr-1 h-4 w-4" />
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
        <Button size="sm" onClick={onPublish}>
          <RocketIcon className="mr-1 h-4 w-4" />
          Publish
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create canvas status bar**

Create `apps/web-ui/components/agent-studio/canvas/canvas-status-bar.tsx`:

```tsx
'use client';

import { useAgentCanvasStore } from '@/stores/agent-canvas-store';
import { Badge } from '@/components/ui/badge';
import { CheckCircleIcon, AlertTriangleIcon } from 'lucide-react';

interface CanvasStatusBarProps {
  lastSaved?: string;
}

export function CanvasStatusBar({ lastSaved }: CanvasStatusBarProps) {
  const { nodes, validationErrors } = useAgentCanvasStore();
  const hasErrors = validationErrors.length > 0;

  return (
    <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        {hasErrors ? (
          <span className="flex items-center gap-1 text-destructive">
            <AlertTriangleIcon className="h-3 w-3" />
            {validationErrors.length} error{validationErrors.length !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-green-600">
            <CheckCircleIcon className="h-3 w-3" />
            Valid
          </span>
        )}
        <span>{nodes.length} node{nodes.length !== 1 ? 's' : ''}</span>
      </div>
      {lastSaved && <span>Last saved: {new Date(lastSaved).toLocaleTimeString()}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Create main canvas wrapper**

Create `apps/web-ui/components/agent-studio/canvas/agent-canvas.tsx`:

```tsx
'use client';

import { useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useAgentCanvasStore } from '@/stores/agent-canvas-store';
import { nodeTypes } from '../nodes/node-types';
import { NodePalette } from './node-palette';
import { ConfigPanel } from './config-panel';
import { CanvasToolbar } from './canvas-toolbar';
import { CanvasStatusBar } from './canvas-status-bar';
import { useSaveVersion, usePublishVersion } from '@/hooks/use-agent-versions';

const DEFAULT_CONFIGS: Record<string, any> = {
  llm: { nodeType: 'llm', provider: 'anthropic', modelId: 'claude-sonnet-4-20250514', temperature: 0.7, maxTokens: 4096, systemPrompt: '', stopSequences: [] },
  tool: { nodeType: 'tool', tools: [{ name: '', description: '', parameters: {} }] },
  router: { nodeType: 'router', conditionType: 'natural-language', condition: '' },
  'state-schema': { nodeType: 'state-schema', fields: [{ name: 'messages', type: 'array' }] },
};

interface AgentCanvasProps {
  agentId: string;
  agentName: string;
  currentVersion: number;
}

export function AgentCanvas({ agentId, agentName, currentVersion }: AgentCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

  const {
    nodes, edges, viewport, selectedNodeId,
    onNodesChange, onEdgesChange, onConnect,
    addNode, setSelectedNodeId, setViewport,
    setValidationErrors, setIsDirty, loadGraph,
    pushHistory,
  } = useAgentCanvasStore();

  const saveVersion = useSaveVersion(agentId);
  const publishVersion = usePublishVersion(agentId);

  const handleSave = useCallback(() => {
    const graphDef = { nodes, edges, viewport };
    saveVersion.mutate({ graphDef }, {
      onSuccess: (data) => {
        setIsDirty(false);
        if (data.validationErrors) setValidationErrors(data.validationErrors);
      },
    });
  }, [nodes, edges, viewport, saveVersion, setIsDirty, setValidationErrors]);

  const handlePublish = useCallback(() => {
    publishVersion.mutate(currentVersion);
  }, [publishVersion, currentVersion]);

  // Auto-save with debounce
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const isDirty = useAgentCanvasStore((s) => s.isDirty);

  useEffect(() => {
    if (!isDirty) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(handleSave, 2000);
    return () => clearTimeout(saveTimerRef.current);
  }, [isDirty, nodes, edges, handleSave]);

  const handleAddNode = useCallback((type: string) => {
    const position = reactFlowInstance.current
      ? reactFlowInstance.current.screenToFlowPosition({ x: 300, y: 300 })
      : { x: 250, y: 250 };
    const newNode = {
      id: `${type}-${Date.now()}`,
      type,
      position,
      data: { ...DEFAULT_CONFIGS[type] },
    };
    addNode(newNode);
  }, [addNode]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/reactflow');
    if (!type || !reactFlowInstance.current) return;
    const position = reactFlowInstance.current.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    const newNode = {
      id: `${type}-${Date.now()}`,
      type,
      position,
      data: { ...DEFAULT_CONFIGS[type] },
    };
    pushHistory();
    addNode(newNode);
  }, [addNode, pushHistory]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onNodeClick = useCallback((_: any, node: any) => {
    setSelectedNodeId(node.id);
  }, [setSelectedNodeId]);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  return (
    <div className="flex h-full flex-col">
      <CanvasToolbar
        agentName={agentName}
        version={currentVersion}
        isSaving={saveVersion.isPending}
        onSave={handleSave}
        onPublish={handlePublish}
      />
      <div className="flex flex-1 overflow-hidden">
        <NodePalette onAddNode={handleAddNode} />
        <div className="flex-1" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={(instance) => { reactFlowInstance.current = instance; }}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Controls />
            <MiniMap />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          </ReactFlow>
        </div>
        <div className="w-72">
          <ConfigPanel />
        </div>
      </div>
      <CanvasStatusBar lastSaved={saveVersion.data?.version?.createdAt} />
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/components/agent-studio/canvas/
git commit -m "feat(agent-studio): add canvas page with node palette, toolbar, status bar, and React Flow canvas"
```

---

## Task 13: Agent detail page (canvas or simple form) + simple agent form

**Files:**
- Create: `apps/web-ui/components/agent-studio/forms/simple-agent-form.tsx`
- Create: `apps/web-ui/app/(dashboard)/agents/[id]/page.tsx`
- Create: `apps/web-ui/app/(dashboard)/agents/[id]/settings/page.tsx`

- [ ] **Step 1: Create simple agent form**

Create `apps/web-ui/components/agent-studio/forms/simple-agent-form.tsx`:

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SaveIcon } from 'lucide-react';
import { useSaveVersion } from '@/hooks/use-agent-versions';

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'bedrock', label: 'AWS Bedrock' },
  { value: 'ollama', label: 'Ollama' },
];

interface SimpleAgentFormProps {
  agentId: string;
  initialConfig: any;
}

export function SimpleAgentForm({ agentId, initialConfig }: SimpleAgentFormProps) {
  const [config, setConfig] = useState(initialConfig ?? {
    model: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 4096,
    tools: [],
    memory: { contextWindowSize: 10 },
  });

  const saveVersion = useSaveVersion(agentId);

  const handleSave = useCallback(() => {
    saveVersion.mutate({ config });
  }, [config, saveVersion]);

  const update = (path: string, value: unknown) => {
    setConfig((prev: any) => {
      const copy = { ...prev };
      const keys = path.split('.');
      let obj: any = copy;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return copy;
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Agent Configuration</h2>
        <Button onClick={handleSave} disabled={saveVersion.isPending}>
          <SaveIcon className="mr-1 h-4 w-4" />
          {saveVersion.isPending ? 'Saving...' : 'Save'}
        </Button>
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <h3 className="text-sm font-medium">Model</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Provider</Label>
            <Select value={config.model?.provider ?? ''} onValueChange={(v) => update('model.provider', v)}>
              <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Model ID</Label>
            <Input value={config.model?.modelId ?? ''} onChange={(e) => update('model.modelId', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <h3 className="text-sm font-medium">Prompt & Parameters</h3>
        <div className="grid gap-2">
          <Label>System Prompt</Label>
          <Textarea value={config.systemPrompt ?? ''} onChange={(e) => update('systemPrompt', e.target.value)} rows={5} placeholder="You are a helpful assistant..." />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Temperature: {config.temperature ?? 0.7}</Label>
            <Slider min={0} max={2} step={0.1} value={[config.temperature ?? 0.7]} onValueChange={([v]) => update('temperature', v)} />
          </div>
          <div className="grid gap-2">
            <Label>Max Tokens</Label>
            <Input type="number" value={config.maxTokens ?? 4096} onChange={(e) => update('maxTokens', parseInt(e.target.value, 10))} />
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <h3 className="text-sm font-medium">Memory</h3>
        <div className="grid gap-2">
          <Label>Context Window Size (messages)</Label>
          <Input type="number" value={config.memory?.contextWindowSize ?? 10} onChange={(e) => update('memory.contextWindowSize', parseInt(e.target.value, 10))} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create agent detail page**

Create `apps/web-ui/app/(dashboard)/agents/[id]/page.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useAgent } from '@/hooks/use-agents';
import { useAgentCanvasStore } from '@/stores/agent-canvas-store';
import { AgentCanvas } from '@/components/agent-studio/canvas/agent-canvas';
import { SimpleAgentForm } from '@/components/agent-studio/forms/simple-agent-form';

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: agent, isLoading } = useAgent(id);
  const loadGraph = useAgentCanvasStore((s) => s.loadGraph);
  const reset = useAgentCanvasStore((s) => s.reset);

  useEffect(() => {
    if (!agent?.versions?.[0]) return;
    const version = agent.versions[0];
    if (agent.type === 'workflow' && version.graphDef) {
      const { nodes, edges, viewport } = version.graphDef as any;
      loadGraph(nodes ?? [], edges ?? [], viewport ?? { x: 0, y: 0, zoom: 1 });
    }
    return () => reset();
  }, [agent, loadGraph, reset]);

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading agent...</div>;
  }

  if (!agent) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Agent not found</div>;
  }

  if (agent.type === 'simple') {
    return <SimpleAgentForm agentId={id} initialConfig={agent.versions?.[0]?.config} />;
  }

  return (
    <AgentCanvas
      agentId={id}
      agentName={agent.name}
      currentVersion={agent.versions?.[0]?.version ?? 1}
    />
  );
}
```

- [ ] **Step 3: Create agent settings page**

Create `apps/web-ui/app/(dashboard)/agents/[id]/settings/page.tsx`:

```tsx
'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useAgent, useUpdateAgent, useDeleteAgent } from '@/hooks/use-agents';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { SaveIcon, TrashIcon } from 'lucide-react';

export default function AgentSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: agent, isLoading } = useAgent(id);
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (agent) {
      setName(agent.name);
      setDescription(agent.description ?? '');
    }
  }, [agent]);

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (!agent) return <div className="p-6 text-muted-foreground">Agent not found</div>;

  const handleSave = () => {
    updateAgent.mutate({ id, name, description });
  };

  const handleDelete = () => {
    if (!confirm('Are you sure you want to archive this agent?')) return;
    deleteAgent.mutate(id, { onSuccess: () => router.push('/agents') });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h2 className="text-lg font-semibold">Agent Settings</h2>
      <div className="space-y-4">
        <div className="grid gap-2">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label>Description</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </div>
        <div className="flex items-center justify-between pt-4">
          <Button variant="destructive" onClick={handleDelete}>
            <TrashIcon className="mr-1 h-4 w-4" /> Archive Agent
          </Button>
          <Button onClick={handleSave} disabled={updateAgent.isPending}>
            <SaveIcon className="mr-1 h-4 w-4" />
            {updateAgent.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify the full flow in the browser**

Run: `bun run dev`

Test flow:
1. Navigate to `/agents` — see empty state
2. Click "Create Agent" → select "Workflow" → name it "Test Agent" → create
3. Redirected to canvas page — see React Flow canvas with palette, toolbar, status bar
4. Drag an LLM node onto canvas — see blue node appear
5. Click the node — see config panel on right with LLM form
6. Drag a Tool node — connect LLM → Tool with an edge
7. Wait 2s — auto-save fires
8. Reload page — graph persists

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/components/agent-studio/forms/simple-agent-form.tsx apps/web-ui/app/\(dashboard\)/agents/\[id\]/
git commit -m "feat(agent-studio): add agent detail page with canvas and simple agent form"
```

---

## Task 14: Final integration — update index exports + verify full build

**Files:**
- Modify: `libs/agent-studio/src/index.ts`

- [ ] **Step 1: Ensure all exports are correct in `libs/agent-studio/src/index.ts`**

Verify the file exports all types, services, and the registry. Add any missing imports for the node registration side effects:

```typescript
// Side-effect imports — register node types
import './registry/nodes/llm-node';
import './registry/nodes/tool-node';
import './registry/nodes/router-node';
import './registry/nodes/state-schema-node';

// Types
export type {
  AgentType,
  AgentStatus,
  AgentVersionStatus,
  CreateAgentInput,
  UpdateAgentInput,
  AgentFilters,
  GraphDefinition,
  GraphNode,
  GraphEdge,
  SimpleAgentConfig,
} from './types/agent';

export type {
  NodeType,
  NodeConfig,
  LlmNodeConfig,
  ToolNodeConfig,
  RouterNodeConfig,
  StateSchemaNodeConfig,
  ToolConfig,
  SchemaField,
  ValidationError,
} from './types/nodes';

// Registry
export { NodeRegistry } from './registry/node-registry';
export type { NodeTypeDefinition, HandleDefinition } from './registry/node-registry';

// Services
export { AgentService } from './services/agent-service';
export { AgentVersionService } from './services/agent-version-service';
export { GraphValidationService } from './services/graph-validation-service';

// Validation
export { validateGraph } from './validation/rules';
```

- [ ] **Step 2: Run all agent-studio tests**

Run: `nx test agent-studio`

Expected: All tests PASS.

- [ ] **Step 3: Run shared tests (RBAC changes)**

Run: `nx test shared`

Expected: All tests PASS.

- [ ] **Step 4: Build the full project**

Run: `bun run build`

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add libs/agent-studio/src/index.ts
git commit -m "feat(agent-studio): finalize exports and verify full build"
```

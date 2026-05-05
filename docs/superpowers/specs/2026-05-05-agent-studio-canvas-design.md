# Agent Studio — Canvas + Agent Config Design Spec

**Date:** 2026-05-05
**Scope:** Visual LangGraph canvas, agent configuration panel, service layer, and data model
**Status:** Draft

---

## Overview

Agent Studio is a new module within the existing chatbot monorepo that enables users to visually build and configure AI agents. It supports two agent types:

- **Simple Agent (Chatbot)** — Form-based configuration. No canvas. Compiled to a LangChain.js chain at runtime. Quick-start path for basic chatbot use cases.
- **Workflow Agent** — Full visual canvas with drag-and-drop nodes and edges. Compiled to a LangGraph.js StateGraph at runtime. Supports ReAct, Plan-and-Execute, and Multi-Agent Supervisor patterns.

This spec covers the first sub-project: the canvas UI, agent configuration panel, service layer library, data model, and API routes. Knowledge base, playground, deployment, and observability are separate future specs.

---

## Architecture

**Approach: Service Layer Extraction (Approach B)**

A new `libs/agent-studio` library contains all agent domain logic (types, validation, node registry, services). The Next.js app consumes it via API routes. Canvas UI lives in `apps/web-ui`. Workers can import the library directly for future background jobs (e.g., agent compilation, scheduled validation).

**Stack decisions:**
- All TypeScript — no Python/FastAPI. LangGraph.js for workflow agents, LangChain.js for simple agents.
- React Flow for the visual canvas.
- TanStack Query for server state management.
- Zustand for canvas client state.
- Agent graph definitions stored as JSON in PostgreSQL via Prisma.
- Path alias: `@chatbot/agent-studio` → `libs/agent-studio/src/index.ts`

---

## Data Model

### New Prisma Models

```prisma
model Agent {
  id          String   @id @default(cuid())
  tenantId    String
  createdBy   String
  name        String
  description String?
  type        String   // "simple" | "workflow"
  status      String   @default("draft") // "draft" | "published" | "archived"
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
  graphDef    Json?     // null for simple agents; { nodes, edges, viewport } for workflow
  config      Json      // LLM settings, tools, prompts, memory config
  changelog   String?
  status      String    @default("draft") // "draft" | "published"
  publishedAt DateTime?
  createdAt   DateTime  @default(now())

  agent      Agent            @relation(fields: [agentId], references: [id], onDelete: Cascade)
  executions AgentExecution[]

  @@unique([agentId, version])
  @@index([agentId])
  @@map("agent_versions")
}

model AgentExecution {
  id        String   @id @default(cuid())
  agentId   String
  versionId String
  tenantId  String
  userId    String
  input     Json
  output    Json?
  status    String   @default("running") // "running" | "completed" | "failed"
  error     String?
  duration  Int?     // milliseconds
  tokenUsage Json?   // { prompt, completion, total }
  createdAt DateTime @default(now())

  version AgentVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@index([agentId])
  @@index([tenantId])
  @@index([tenantId, createdAt])
  @@map("agent_executions")
}
```

The `Tenant` model gains a new `agents Agent[]` relation field.

**Note:** `AgentExecution` is defined here for schema completeness but has no API routes in this spec. It will be used by the Playground spec.

### Graph Definition Shape (workflow agents)

```typescript
interface GraphDefinition {
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewport: { x: number; y: number; zoom: number };
}

interface GraphNode {
  id: string;
  type: "llm" | "tool" | "router" | "state-schema";
  position: { x: number; y: number };
  data: NodeConfig; // type-specific config
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
  data?: { condition?: string };
}
```

### Simple Agent Config Shape

```typescript
interface SimpleAgentConfig {
  model: { provider: string; modelId: string };
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  tools: ToolConfig[];
  memory: {
    contextWindowSize: number;
    summarizationTrigger?: number;
  };
}
```

---

## Service Layer: `libs/agent-studio`

### File Structure

```
libs/agent-studio/
  src/
    index.ts
    types/
      agent.ts              # Agent, AgentVersion, GraphDefinition types
      nodes.ts              # GraphNode, GraphEdge, NodeConfig types
    registry/
      node-registry.ts      # Node type registry
      nodes/
        llm-node.ts         # LLM node type definition + Zod config schema
        tool-node.ts
        router-node.ts
        state-schema-node.ts
    services/
      agent-service.ts
      agent-version-service.ts
      graph-validation-service.ts
    validation/
      graph-validator.ts
      rules/
        no-orphan-nodes.ts
        entry-node-exists.ts
        valid-connections.ts
        router-edge-count.ts
        state-schema-required.ts
        no-unbounded-cycles.ts
    templates/
      simple-chatbot.ts
      react-agent.ts
  vitest.config.ts
  project.json
  tsconfig.json
  package.json
```

### Services

**`AgentService`** — CRUD operations following the existing class-based pattern with Prisma client injection.

| Method | Description |
|---|---|
| `createAgent(tenantId, userId, data)` | Creates agent + initial version (v1) |
| `updateAgent(agentId, data)` | Updates agent metadata (name, description, tags) |
| `listAgents(tenantId, filters)` | Paginated list with search by name, filter by type/status |
| `getAgent(agentId)` | Full agent with current (latest) version |
| `deleteAgent(agentId)` | Soft delete — sets status to "archived" |

**`AgentVersionService`** — Version management.

| Method | Description |
|---|---|
| `saveVersion(agentId, graphDef, config)` | Auto-increments version number (per-agent sequential integer starting at 1), stores graph JSON + config JSON |
| `getVersion(agentId, version)` | Returns specific version |
| `listVersions(agentId)` | All versions for an agent |
| `publishVersion(agentId, version)` | Sets status to "published", records publishedAt |
| `diffVersions(agentId, v1, v2)` | Returns JSON diff of graph and config changes |

**`GraphValidationService`** — Validates workflow agent graphs.

Validation rules:
- No orphan nodes (every node must have at least one connection)
- Entry node exists (exactly one node marked as entry point)
- All edges connect valid, existing nodes
- Router nodes have at least 2 outgoing edges
- State schema node exists (required for workflow agents)
- No unbounded cycles (cycles must pass through a node with a termination condition)

Returns structured errors: `{ nodeId?: string, edgeId?: string, rule: string, message: string }[]`. The canvas uses `nodeId`/`edgeId` to highlight problem areas.

**`NodeRegistry`** — Extensible registry of node types.

Each registered node type defines:
- `type` — unique identifier (e.g., "llm", "tool", "router", "state-schema")
- `label` — display name
- `category` — for palette grouping ("AI", "Logic", "Data")
- `icon` — icon identifier for the palette and canvas
- `defaultConfig` — default configuration when node is first created
- `configSchema` — Zod schema for validating node config
- `handles` — input/output handle definitions (how many, positions)

New node types (Retriever, Memory, Human-in-the-Loop) register here in future phases without changing existing code.

---

## Canvas UI

### Routes

| Route | Description |
|---|---|
| `(dashboard)/agents` | Agent list page — cards for all agents with status, type badge, last edited, version |
| `(dashboard)/agents/[id]` | Workflow: full-screen React Flow canvas. Simple: form-based config page |
| `(dashboard)/agents/[id]/settings` | Agent-level settings (name, description, tags, default LLM provider) |

### Canvas Layout (workflow agents)

```
┌──────────────────────────────────────────────────────────────┐
│  Top Bar: Agent name | Version badge | Undo/Redo | Save | Publish  │
├────────┬─────────────────────────────────────┬───────────────┤
│        │                                     │               │
│ Node   │         React Flow Canvas           │  Config       │
│ Palette│                                     │  Panel        │
│        │   (zoom, pan, minimap, auto-layout) │               │
│ - LLM  │                                     │  (shows       │
│ - Tool │                                     │   selected    │
│ - Router│                                    │   node's      │
│ - State│                                     │   config      │
│        │                                     │   form)       │
│        │                                     │               │
├────────┴─────────────────────────────────────┴───────────────┤
│  Status bar: Validation status | Node count | Last saved     │
└──────────────────────────────────────────────────────────────┘
```

- **Left sidebar (Node Palette):** Categorized list of draggable node types. Drag onto canvas to create.
- **Center (Canvas):** React Flow with zoom, pan, minimap, auto-layout. Nodes rendered as custom React Flow components.
- **Right panel (Config Panel):** Context-sensitive. Shows selected node's config form, or agent-level settings when nothing is selected.
- **Top bar:** Agent name (editable), version indicator, undo/redo buttons, save button, publish button.
- **Status bar:** Validation status (valid/errors), node count, last saved timestamp.

### Custom Node Components

Each node type has a custom React Flow node component in `components/agent-studio/nodes/`:

| Component | Visual | Shows |
|---|---|---|
| `LlmNode` | Rounded rectangle, blue accent | Model name, system prompt preview (truncated), temperature badge |
| `ToolNode` | Rounded rectangle, green accent | Tool name(s), parameter count badge |
| `RouterNode` | Diamond shape, orange accent | Condition preview text |
| `StateSchemaNode` | Rounded rectangle, purple accent | Field names and types list |

### Node Config Forms

Each node type has a dedicated config form in `components/agent-studio/forms/`:

**LLM Node:**
- Model provider dropdown (OpenAI, Anthropic, Bedrock, Ollama, custom endpoint)
- Model ID (filtered by selected provider)
- Temperature slider (0–2)
- Max tokens input
- System prompt editor (textarea with variable interpolation preview: `{{user_name}}`, `{{context}}`)
- Stop sequences (tag input)

**Tool Node:**
- Tool selector (multi-select from registered tools)
- Per-tool: function name, description, JSON Schema parameter editor
- Built-in tools: web search, code interpreter, calculator, HTTP request
- Custom tool: name, params, implementation via Monaco editor

**Router Node:**
- Condition type toggle: natural language or code
- Natural language: text input describing routing condition
- Code: Monaco editor for TypeScript function `(state) => string` returning target node ID
- Output edges auto-labeled with condition branches

**State Schema Node:**
- Field list: name, type (string, number, boolean, array, object), default value
- Add/remove field buttons
- Defines the state shape flowing through the graph

**Simple Agent Form (no canvas):**
- Model provider + model ID
- System prompt editor
- Tool selector
- Memory settings (context window size, summarization trigger)
- Temperature, max tokens

All forms use shadcn/ui components (Select, Slider, Input, Textarea, Tabs, Dialog) for consistency.

### State Management

**Zustand store (`stores/agent-canvas-store.ts`):**
- `nodes: Node[]` — React Flow nodes
- `edges: Edge[]` — React Flow edges
- `viewport: Viewport` — current zoom/pan
- `selectedNodeId: string | null`
- `isDirty: boolean` — unsaved changes flag
- `validationErrors: ValidationError[]`
- `onNodesChange`, `onEdgesChange` — React Flow change handlers
- `addNode(type, position)`, `removeNode(id)`, `updateNodeConfig(id, config)`
- `undo()`, `redo()` — history stack

**TanStack Query hooks (`hooks/`):**
- `useAgents(filters)` — list agents for current tenant
- `useAgent(id)` — single agent with current version
- `useAgentVersions(id)` — version list
- `useSaveVersion()` — mutation for auto-save
- `usePublishVersion()` — mutation for publishing
- `useValidateGraph()` — mutation for on-demand validation

### Auto-Save Flow

1. User edits canvas → Zustand store updates immediately
2. `isDirty` flag set to `true`
3. Debounce timer starts (2 seconds after last change)
4. Timer fires → `useSaveVersion` mutation called with current `{ nodes, edges, viewport }` + config
5. Server runs `GraphValidationService` — returns validation errors if any, but saves as draft regardless
6. Canvas highlights problem nodes/edges from validation errors
7. `isDirty` reset to `false`, TanStack Query cache invalidated

---

## API Routes

All routes under `apps/web-ui/app/api/agents/`.

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/agents` | Create agent (simple or workflow) |
| `GET` | `/api/agents` | List agents for current tenant (paginated, filterable) |
| `GET` | `/api/agents/[id]` | Get agent with current version |
| `PATCH` | `/api/agents/[id]` | Update agent metadata |
| `DELETE` | `/api/agents/[id]` | Soft delete (archive) |
| `POST` | `/api/agents/[id]/versions` | Save new version (auto-save from canvas) |
| `GET` | `/api/agents/[id]/versions` | List all versions |
| `GET` | `/api/agents/[id]/versions/[version]` | Get specific version |
| `POST` | `/api/agents/[id]/versions/[version]/publish` | Publish a version |
| `POST` | `/api/agents/[id]/validate` | Validate graph without saving |

All routes use `getAuthSession()` + tenant middleware. Agents scoped to `tenantId`.

### RBAC Permissions

New permissions added to the existing RBAC system:

| Permission | Owner | Admin | Developer | Viewer |
|---|---|---|---|---|
| `agent:create` | Y | Y | Y | - |
| `agent:read` | Y | Y | Y | Y |
| `agent:update` | Y | Y | Y | - |
| `agent:delete` | Y | Y | - | - |
| `agent:publish` | Y | Y | - | - |

---

## Navigation Integration

Add "Agent Studio" entry to `nav-main.tsx` in the existing sidebar:
- Icon: Bot (from Lucide)
- Label: "Agent Studio"
- Route: `(dashboard)/agents`
- Position: after "Chat" in the sidebar

---

## Frontend File Organization

```
apps/web-ui/
  app/(dashboard)/agents/
    page.tsx                        # Agent list page
    [id]/
      page.tsx                      # Canvas (workflow) or config form (simple)
      settings/
        page.tsx                    # Agent settings
  app/api/agents/
    route.ts                        # POST (create) + GET (list)
    [id]/
      route.ts                      # GET + PATCH + DELETE
      versions/
        route.ts                    # POST (save) + GET (list)
        [version]/
          route.ts                  # GET specific version
          publish/
            route.ts                # POST publish
      validate/
        route.ts                    # POST validate
  components/agent-studio/
    canvas/
      agent-canvas.tsx              # Main React Flow canvas wrapper
      node-palette.tsx              # Left sidebar draggable node list
      config-panel.tsx              # Right panel config forms
    nodes/
      llm-node.tsx
      tool-node.tsx
      router-node.tsx
      state-schema-node.tsx
    forms/
      llm-config-form.tsx
      tool-config-form.tsx
      router-config-form.tsx
      state-schema-form.tsx
      simple-agent-form.tsx
    agent-list.tsx
    create-agent-dialog.tsx
  stores/
    agent-canvas-store.ts
  hooks/
    use-agents.ts
    use-agent.ts
    use-agent-versions.ts
```

---

## Testing Strategy

**Unit tests (`libs/agent-studio`):**
- `AgentService` — CRUD with mocked Prisma client
- `AgentVersionService` — version auto-increment, publish logic
- `GraphValidationService` — each validation rule tested independently (orphan nodes, missing entry, invalid edges, router edge count, missing state schema, unbounded cycles)
- `NodeRegistry` — registration, lookup, config schema validation via Zod

**E2E tests (Playwright):**
- Create simple agent → configure → save → verify persisted
- Create workflow agent → drag LLM node → drag Tool node → connect edge → save → reload → verify graph intact
- Publish version → verify status change
- RBAC: Viewer cannot create/edit agents

**No unit tests for React Flow canvas interactions** — these are brittle and better covered by e2e tests.

---

## Dependencies

New packages to install:

| Package | Purpose |
|---|---|
| `@xyflow/react` | React Flow canvas library |
| `@langchain/core` | LangChain.js core (simple agents) |
| `@langchain/langgraph` | LangGraph.js (workflow agents) |
| `@monaco-editor/react` | Monaco editor for code nodes and custom tools |

---

## Out of Scope

- Knowledge base / RAG integration (separate spec)
- Playground / live testing (separate spec)
- Deployment / API gateway (separate spec)
- Observability / monitoring (separate spec)
- Code export / import (Phase 2)
- Subgraph node, Human-in-the-Loop node, Memory node (Phase 2 node types)
- Multi-agent supervisor topology (Phase 2 — requires Subgraph node)
- Real-time collaborative editing (Phase 3)
- CompilerService implementation (interface defined, implementation in playground spec)

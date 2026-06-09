# Chat Widget Designer (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the designer UI that lets a tenant author an agent's workflow tree on a React Flow canvas, activate it, and toggle thinking visibility — closing the three-phase loop (author → backend emits → widget renders).

**Architecture:** A pure, unit-tested `graph ↔ WorkflowDefinition` mapping module in `libs/shared` (keystone, no React dependency, runs in the working Vitest harness). An `AgentWorkflowService` + `/api/agents/[id]/workflows` routes persist a single workflow row per agent (single-draft + activate toggle). A "Workflow" tab on the agent edit page hosts a React Flow canvas modeled on the existing agent-studio canvas. A per-agent `showThinking` flag on the `Agent` model is honored by extending the Phase 2 `PartStreamEmitter`.

**Tech Stack:** `@xyflow/react` ^12, `@tanstack/react-form` + Zod, shadcn/ui (tabs, card, switch, input, select, dialog, sonner), Prisma, Vitest, Pino. Consumes Phase 2 `workflowDefinitionSchema`/`WorkflowDefinition` from `@chatbot/shared` and `PartStreamEmitter` from `@chatbot/ai`.

**Test commands:**
- libs single file: from repo root, `bunx vitest run libs/shared/src/<path>.test.ts`
- all affected: `nx affected -t test`
- prisma client regen: `bunx prisma generate --schema=./prisma/schema.prisma`
- additive schema to local DB (project convention — NOT `migrate dev`, which fails on this repo's shadow-DB history): `bunx prisma db push --schema=./prisma/schema.prisma`
- web-ui typecheck: `nx build web-ui` (note: `next.config.ts` has `typescript.ignoreBuildErrors: true`, so run `bunx tsc --noEmit -p apps/web-ui/tsconfig.json` for real type signal)

> **Test-harness note:** `libs/shared` Vitest specs run cleanly. The pure mapping module + service + emitter change are the unit-tested core. The React Flow canvas component is verified MANUALLY (dev server) — do NOT write `render()`-based component specs (the `@stencil/vitest`-style harness issue is SDK-only, but web-ui has no component-test setup wired; canvas interaction isn't unit-covered by design).

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `libs/shared/src/workflow/workflow-graph.ts` | Pure `graph ↔ WorkflowDefinition` mapping + `validateGraph` (keystone) |
| Create | `libs/shared/src/workflow/workflow-graph.test.ts` | Unit tests: round-trip, entry detect, option→transition, validation rules |
| Modify | `libs/shared/src/workflow/workflow-types.ts` | Export the individual node schemas + add `GraphNode`/`GraphEdge`/`GraphError` types |
| Create | `libs/shared/src/services/agent-workflow-service.ts` | `getByAgent` / `upsert` / `setActive` (injected db) |
| Create | `libs/shared/src/services/agent-workflow-service.test.ts` | Service unit tests (fake db) |
| Modify | `libs/shared/src/index.ts` | Export workflow-graph + AgentWorkflowService |
| Modify | `prisma/schema.prisma` | Add `Agent.showThinking Boolean @default(true)` |
| Modify | `libs/ai/src/part-stream-emitter.ts` | Constructor opts `{ showThinking }`; suppress thinking events when false |
| Modify | `libs/ai/src/part-stream-emitter.test.ts` | Add `showThinking:false` case |
| Modify | `apps/web-ui/app/api/v1/inference/route.ts` | Pass `{ showThinking: agent.showThinking }` into emitter |
| Create | `apps/web-ui/app/api/agents/[id]/workflows/route.ts` | `GET` (load) + `PUT` (save, Zod-validated) |
| Create | `apps/web-ui/app/api/agents/[id]/workflows/activate/route.ts` | `POST` (flip isActive) |
| Modify | `libs/shared/src/validation/` (agent schema) | Extend `updateAgentSchema` to accept `showThinking` |
| Create | `apps/web-ui/components/agents/workflow/workflow-node-types.tsx` | React Flow custom nodes: menu (option handles), text, file |
| Create | `apps/web-ui/components/agents/workflow/workflow-palette.tsx` | Drag-source palette for the 3 node types |
| Create | `apps/web-ui/components/agents/workflow/workflow-inspector.tsx` | Inline side panel editing selected-node fields |
| Create | `apps/web-ui/components/agents/workflow/workflow-canvas.tsx` | React Flow shell wiring palette + inspector + save/activate |
| Create | `apps/web-ui/components/agents/workflow/workflow-preview-dialog.tsx` | Dialog rendering the widget via mock transport |
| Modify | `apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx` | Add the "Workflow" tab mounting the canvas |

---

### Task 1: Expose node schemas + graph types

**Files:**
- Modify: `libs/shared/src/workflow/workflow-types.ts`

The keystone mapping needs to build/validate individual nodes and model React Flow's `{nodes, edges}` shape WITHOUT importing `@xyflow/react` (keeps it pure + lib-testable). Local structural types suffice.

- [ ] **Step 1: Export the per-node schemas and add graph types.** In `workflow-types.ts`, change the three `const` node schema declarations to `export const`, and append the graph types + a `GraphError` type:

```typescript
// change these three lines from `const` to `export const`:
export const menuNodeSchema = z.object({ /* unchanged */ });
export const textNodeSchema = z.object({ /* unchanged */ });
export const fileNodeSchema = z.object({ /* unchanged */ });
export const menuOptionSchema = z.object({ /* unchanged — also export */ });

// append at end of file:

/** Structural mirror of a React Flow node (no @xyflow import here). */
export interface GraphNode {
  id: string;
  /** node kind */
  type: 'menu' | 'text' | 'file';
  position: { x: number; y: number };
  data: {
    // menu
    title?: string;
    options?: MenuOption[];
    // text
    text?: string;
    // file
    fileRef?: string;
  };
}

/** Structural mirror of a React Flow edge. sourceHandle = the menu option's value. */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface GraphError {
  code: 'no-entry' | 'multiple-entry' | 'dup-option-value' | 'dangling-transition' | 'missing-target' | 'unreachable';
  message: string;
  nodeId?: string;
}
```

- [ ] **Step 2: Verify it compiles.** `bunx tsc --noEmit -p libs/shared/tsconfig.lib.json`. Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add libs/shared/src/workflow/workflow-types.ts
git commit -m "feat(shared): export node schemas and add graph<->definition types"
```

---

### Task 2: The keystone — `graph ↔ WorkflowDefinition` mapping

**Files:**
- Create: `libs/shared/src/workflow/workflow-graph.ts`
- Create: `libs/shared/src/workflow/workflow-graph.test.ts`

- [ ] **Step 1: Write the failing test** (`workflow-graph.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { graphToDefinition, definitionToGraph, validateGraph } from './workflow-graph';
import type { GraphNode, GraphEdge } from './workflow-types';
import type { WorkflowDefinition } from './workflow-types';

const nodes: GraphNode[] = [
  { id: 'main', type: 'menu', position: { x: 0, y: 0 }, data: { title: 'Pick', options: [
    { label: 'Billing', value: 'billing' }, { label: 'Support', value: 'support' },
  ] } },
  { id: 'bill', type: 'menu', position: { x: 200, y: 0 }, data: { title: 'Billing', options: [{ label: 'Refund', value: 'refund' }] } },
  { id: 'supp', type: 'text', position: { x: 200, y: 120 }, data: { text: 'Describe your issue.' } },
  { id: 'done', type: 'text', position: { x: 400, y: 0 }, data: { text: 'Refund started.' } },
];
const edges: GraphEdge[] = [
  { id: 'e1', source: 'main', target: 'bill', sourceHandle: 'billing' },
  { id: 'e2', source: 'main', target: 'supp', sourceHandle: 'support' },
  { id: 'e3', source: 'bill', target: 'done', sourceHandle: 'refund' },
];

describe('graphToDefinition', () => {
  it('maps nodes + edges to a WorkflowDefinition with entry = node with no inbound edge', () => {
    const def = graphToDefinition(nodes, edges);
    expect(def.entryNodeId).toBe('main');
    expect(def.nodes).toHaveLength(4);
    expect(def.transitions).toEqual([
      { fromNodeId: 'main', optionValue: 'billing', toNodeId: 'bill' },
      { fromNodeId: 'main', optionValue: 'support', toNodeId: 'supp' },
      { fromNodeId: 'bill', optionValue: 'refund', toNodeId: 'done' },
    ]);
    const menu = def.nodes.find((n) => n.id === 'main');
    expect(menu).toEqual({ id: 'main', type: 'menu', title: 'Pick', options: [
      { label: 'Billing', value: 'billing' }, { label: 'Support', value: 'support' },
    ] });
    expect(def.nodes.find((n) => n.id === 'supp')).toEqual({ id: 'supp', type: 'text', text: 'Describe your issue.' });
  });
});

describe('definitionToGraph', () => {
  it('round-trips a definition back to nodes + edges', () => {
    const def = graphToDefinition(nodes, edges);
    const g = definitionToGraph(def);
    const def2 = graphToDefinition(g.nodes, g.edges);
    expect(def2.entryNodeId).toBe(def.entryNodeId);
    expect(def2.transitions).toEqual(def.transitions);
    expect(def2.nodes).toEqual(def.nodes);
  });
  it('assigns deterministic tiered positions when none are stored', () => {
    const def = graphToDefinition(nodes, edges);
    const g = definitionToGraph(def);
    const main = g.nodes.find((n) => n.id === 'main')!;
    const bill = g.nodes.find((n) => n.id === 'bill')!;
    expect(main.position.x).toBeLessThan(bill.position.x); // entry tier left of its children
  });
});

describe('validateGraph', () => {
  it('passes a well-formed graph', () => {
    expect(validateGraph(nodes, edges)).toEqual([]);
  });
  it('flags no entry (every node has an inbound edge — a cycle)', () => {
    const cyclic: GraphEdge[] = [...edges, { id: 'e4', source: 'done', target: 'main', sourceHandle: 'x' }];
    const errs = validateGraph(nodes, cyclic);
    expect(errs.some((e) => e.code === 'no-entry')).toBe(true);
  });
  it('flags multiple entries', () => {
    const extra: GraphNode[] = [...nodes, { id: 'orphan', type: 'text', position: { x: 0, y: 300 }, data: { text: 'hi' } }];
    const errs = validateGraph(extra, edges);
    expect(errs.some((e) => e.code === 'multiple-entry')).toBe(true);
  });
  it('flags an edge whose sourceHandle is not an option on the source menu', () => {
    const bad: GraphEdge[] = [...edges, { id: 'e5', source: 'main', target: 'done', sourceHandle: 'ghost' }];
    const errs = validateGraph(nodes, bad);
    expect(errs.some((e) => e.code === 'dangling-transition')).toBe(true);
  });
  it('flags an edge to a missing target node', () => {
    const bad: GraphEdge[] = [{ id: 'e1', source: 'main', target: 'nope', sourceHandle: 'billing' }];
    const errs = validateGraph(nodes, bad);
    expect(errs.some((e) => e.code === 'missing-target')).toBe(true);
  });
  it('flags duplicate option values within one menu', () => {
    const dup: GraphNode[] = [{ ...nodes[0], data: { title: 'Pick', options: [
      { label: 'A', value: 'x' }, { label: 'B', value: 'x' },
    ] } }, ...nodes.slice(1)];
    const errs = validateGraph(dup, edges);
    expect(errs.some((e) => e.code === 'dup-option-value')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, expect failure.** `bunx vitest run libs/shared/src/workflow/workflow-graph.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `workflow-graph.ts`**

```typescript
import type {
  GraphNode, GraphEdge, GraphError, WorkflowDefinition, WorkflowNode, WorkflowTransition, MenuOption,
} from './workflow-types';

function nodeToWorkflowNode(n: GraphNode): WorkflowNode {
  if (n.type === 'menu') return { id: n.id, type: 'menu', title: n.data.title, options: n.data.options ?? [] };
  if (n.type === 'text') return { id: n.id, type: 'text', text: n.data.text ?? '' };
  return { id: n.id, type: 'file', fileRef: n.data.fileRef ?? '' };
}

function findEntry(nodes: GraphNode[], edges: GraphEdge[]): string | undefined {
  const hasInbound = new Set(edges.map((e) => e.target));
  const entries = nodes.filter((n) => !hasInbound.has(n.id));
  return entries.length === 1 ? entries[0].id : undefined;
}

export function graphToDefinition(nodes: GraphNode[], edges: GraphEdge[]): WorkflowDefinition {
  const entryNodeId = findEntry(nodes, edges) ?? nodes[0]?.id ?? '';
  const transitions: WorkflowTransition[] = edges
    .filter((e) => e.sourceHandle)
    .map((e) => ({ fromNodeId: e.source, optionValue: e.sourceHandle as string, toNodeId: e.target }));
  return { entryNodeId, nodes: nodes.map(nodeToWorkflowNode), transitions };
}

export function definitionToGraph(def: WorkflowDefinition): { nodes: GraphNode[]; edges: GraphEdge[] } {
  // Deterministic tiered layout: BFS depth from entry → column; index within tier → row.
  const depth = new Map<string, number>();
  depth.set(def.entryNodeId, 0);
  let changed = true;
  let guard = 0;
  while (changed && guard++ < def.nodes.length + 1) {
    changed = false;
    for (const t of def.transitions) {
      const d = depth.get(t.fromNodeId);
      if (d !== undefined && (depth.get(t.toNodeId) ?? -1) < d + 1) {
        depth.set(t.toNodeId, d + 1);
        changed = true;
      }
    }
  }
  const tierCounts = new Map<number, number>();
  const nodes: GraphNode[] = def.nodes.map((n) => {
    const d = depth.get(n.id) ?? 0;
    const row = tierCounts.get(d) ?? 0;
    tierCounts.set(d, row + 1);
    const data =
      n.type === 'menu' ? { title: n.title, options: n.options }
      : n.type === 'text' ? { text: n.text }
      : { fileRef: n.fileRef };
    return { id: n.id, type: n.type, position: { x: d * 240, y: row * 140 }, data };
  });
  const edges: GraphEdge[] = def.transitions.map((t, i) => ({
    id: `e${i}`, source: t.fromNodeId, target: t.toNodeId, sourceHandle: t.optionValue,
  }));
  return { nodes, edges };
}

export function validateGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphError[] {
  const errors: GraphError[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hasInbound = new Set(edges.map((e) => e.target));
  const entries = nodes.filter((n) => !hasInbound.has(n.id));
  if (entries.length === 0) errors.push({ code: 'no-entry', message: 'No entry node — every node has an inbound edge (cycle).' });
  if (entries.length > 1) errors.push({ code: 'multiple-entry', message: `Multiple entry nodes: ${entries.map((e) => e.id).join(', ')}.` });

  for (const n of nodes) {
    if (n.type === 'menu') {
      const values = (n.data.options ?? []).map((o) => o.value);
      const seen = new Set<string>();
      for (const v of values) {
        if (seen.has(v)) errors.push({ code: 'dup-option-value', message: `Duplicate option value "${v}" in menu ${n.id}.`, nodeId: n.id });
        seen.add(v);
      }
    }
  }

  for (const e of edges) {
    if (!byId.has(e.target)) errors.push({ code: 'missing-target', message: `Edge ${e.id} targets missing node ${e.target}.` });
    const src = byId.get(e.source);
    if (src && src.type === 'menu') {
      const ok = (src.data.options ?? []).some((o) => o.value === e.sourceHandle);
      if (!ok) errors.push({ code: 'dangling-transition', message: `Edge ${e.id} handle "${e.sourceHandle}" is not an option on menu ${e.source}.`, nodeId: e.source });
    }
  }

  // Reachability (warn-level, still reported).
  const entry = entries.length === 1 ? entries[0].id : undefined;
  if (entry) {
    const reach = new Set<string>([entry]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of edges) if (reach.has(e.source) && !reach.has(e.target)) { reach.add(e.target); changed = true; }
    }
    for (const n of nodes) if (!reach.has(n.id)) errors.push({ code: 'unreachable', message: `Node ${n.id} is unreachable from entry.`, nodeId: n.id });
  }
  return errors;
}
```

- [ ] **Step 4: Run it, expect pass.** `bunx vitest run libs/shared/src/workflow/workflow-graph.test.ts` → PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/workflow/workflow-graph.ts libs/shared/src/workflow/workflow-graph.test.ts
git commit -m "feat(shared): add pure graph<->WorkflowDefinition mapping and validation"
```

---

### Task 3: AgentWorkflowService

**Files:**
- Create: `libs/shared/src/services/agent-workflow-service.ts`
- Create: `libs/shared/src/services/agent-workflow-service.test.ts`

- [ ] **Step 1: Write the failing test** (`agent-workflow-service.test.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AgentWorkflowService, type AgentWorkflowDb } from './agent-workflow-service';

function fakeDb(existing: any = null): AgentWorkflowDb & { _rows: any[] } {
  const _rows: any[] = existing ? [existing] : [];
  return {
    _rows,
    agentWorkflow: {
      findFirst: vi.fn(async ({ where }: any) => _rows.find((r) => r.agentId === where.agentId) ?? null),
      create: vi.fn(async ({ data }: any) => { const row = { id: 'w1', isActive: false, version: 1, ...data }; _rows.push(row); return row; }),
      update: vi.fn(async ({ where, data }: any) => { const r = _rows.find((x) => x.id === where.id); Object.assign(r, data); return r; }),
    },
  } as any;
}

const def = { entryNodeId: 'a', nodes: [{ id: 'a', type: 'text', text: 'hi' }], transitions: [] };

describe('AgentWorkflowService', () => {
  it('getByAgent returns null when none exists', async () => {
    const svc = new AgentWorkflowService('t1', fakeDb());
    expect(await svc.getByAgent('ag1')).toBeNull();
  });
  it('upsert creates when absent', async () => {
    const db = fakeDb();
    const svc = new AgentWorkflowService('t1', db);
    await svc.upsert('ag1', def);
    expect(db.agentWorkflow.create).toHaveBeenCalledOnce();
    expect(db._rows[0]).toMatchObject({ agentId: 'ag1', tenantId: 't1', definition: def });
  });
  it('upsert updates when present, preserving isActive', async () => {
    const db = fakeDb({ id: 'w1', agentId: 'ag1', tenantId: 't1', isActive: true, version: 1, definition: { old: true } });
    const svc = new AgentWorkflowService('t1', db);
    await svc.upsert('ag1', def);
    expect(db.agentWorkflow.update).toHaveBeenCalledOnce();
    expect(db._rows[0].definition).toEqual(def);
    expect(db._rows[0].isActive).toBe(true);
  });
  it('setActive flips the flag', async () => {
    const db = fakeDb({ id: 'w1', agentId: 'ag1', tenantId: 't1', isActive: false, version: 1, definition: def });
    const svc = new AgentWorkflowService('t1', db);
    await svc.setActive('ag1', true);
    expect(db._rows[0].isActive).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, expect failure.** `bunx vitest run libs/shared/src/services/agent-workflow-service.test.ts` → FAIL.

- [ ] **Step 3: Implement `agent-workflow-service.ts`**

```typescript
import { createLogger } from '../logging/logger';
import type { WorkflowDefinition } from '../workflow/workflow-types';

const logger = createLogger('agent-workflow-service');

export interface AgentWorkflowDb {
  agentWorkflow: {
    findFirst(args: { where: Record<string, unknown> }): Promise<unknown | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
  };
}

interface AgentWorkflowRow { id: string; agentId: string; tenantId: string; isActive: boolean; version: number; definition: unknown }

export class AgentWorkflowService {
  constructor(private readonly tenantId: string, private readonly db: AgentWorkflowDb) {}

  async getByAgent(agentId: string): Promise<AgentWorkflowRow | null> {
    return (await this.db.agentWorkflow.findFirst({ where: { agentId, tenantId: this.tenantId } })) as AgentWorkflowRow | null;
  }

  async upsert(agentId: string, definition: WorkflowDefinition): Promise<AgentWorkflowRow> {
    const existing = await this.getByAgent(agentId);
    if (existing) {
      logger.info({ tenantId: this.tenantId, agentId }, 'Updating agent workflow');
      return (await this.db.agentWorkflow.update({
        where: { id: existing.id },
        data: { definition: definition as unknown as Record<string, unknown> },
      })) as AgentWorkflowRow;
    }
    logger.info({ tenantId: this.tenantId, agentId }, 'Creating agent workflow');
    return (await this.db.agentWorkflow.create({
      data: { agentId, tenantId: this.tenantId, definition: definition as unknown as Record<string, unknown> },
    })) as AgentWorkflowRow;
  }

  async setActive(agentId: string, isActive: boolean): Promise<void> {
    const existing = await this.getByAgent(agentId);
    if (!existing) throw new Error('No workflow to activate for this agent');
    logger.info({ tenantId: this.tenantId, agentId, isActive }, 'Setting agent workflow active state');
    await this.db.agentWorkflow.update({ where: { id: existing.id }, data: { isActive } });
  }
}
```

- [ ] **Step 4: Run it, expect pass.** `bunx vitest run libs/shared/src/services/agent-workflow-service.test.ts` → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/shared/src/services/agent-workflow-service.ts libs/shared/src/services/agent-workflow-service.test.ts
git commit -m "feat(shared): add AgentWorkflowService (getByAgent/upsert/setActive)"
```

---

### Task 4: Export the new shared surface

**Files:**
- Modify: `libs/shared/src/index.ts`

- [ ] **Step 1: Add exports.** Find where workflow types are exported in `libs/shared/src/index.ts` (Phase 2 added `workflowDefinitionSchema`, `WorkflowEngine`, etc.) and add alongside:

```typescript
export {
  graphToDefinition,
  definitionToGraph,
  validateGraph,
} from './workflow/workflow-graph';
export type { GraphNode, GraphEdge, GraphError } from './workflow/workflow-types';
export { AgentWorkflowService, type AgentWorkflowDb } from './services/agent-workflow-service';
```

- [ ] **Step 2: Build.** `nx build shared` → no errors.

- [ ] **Step 3: Commit**

```bash
git add libs/shared/src/index.ts
git commit -m "chore(shared): export workflow-graph helpers and AgentWorkflowService"
```

---

### Task 5: `showThinking` schema + emitter honor

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `libs/ai/src/part-stream-emitter.ts`
- Modify: `libs/ai/src/part-stream-emitter.test.ts`

- [ ] **Step 1: Add the column.** In `model Agent` (prisma/schema.prisma), add after `config Json`:

```prisma
  showThinking Boolean @default(true)
```

- [ ] **Step 2: Push + generate.** `bunx prisma db push --schema=./prisma/schema.prisma` (additive; regenerates client). Expected: "in sync" / success, client regenerated. Verify: `node -e "const{PrismaClient}=require('@prisma/client');new PrismaClient().agent.findFirst({select:{showThinking:true}}).then(()=>console.log('ok')).catch(e=>console.error(e.message))"` → `ok`.

- [ ] **Step 3: Write the failing emitter test.** In `libs/ai/src/part-stream-emitter.test.ts`, add:

```typescript
  it('with showThinking:false, suppresses thinking events and text becomes partIndex 0', async () => {
    async function* g(chunks: any[]) { for (const c of chunks) yield c; }
    const emitter = new PartStreamEmitter('m1', { showThinking: false });
    const out: import('./stream-events').StreamEvent[] = [];
    for await (const ev of emitter.run(g([
      { type: 'tool-call', toolCallId: 't1', toolName: 'search_knowledge_base' },
      { type: 'tool-result', toolCallId: 't1', toolName: 'search_knowledge_base', output: { hits: 4 } },
      { type: 'text-delta', text: 'Answer.' },
      { type: 'finish', usage: { inputTokens: 1, outputTokens: 1 } },
    ]))) out.push(ev);
    expect(out.some((e) => e.partType === 'thinking')).toBe(false);
    expect(out.some((e) => e.type === 'thinking_step')).toBe(false);
    const textStart = out.find((e) => e.type === 'part_start' && e.partType === 'text');
    expect(textStart!.partIndex).toBe(0);
    expect(out.at(-1)!.type).toBe('done');
  });
```

Run: `bunx vitest run libs/ai/src/part-stream-emitter.test.ts` → the new case FAILS (constructor takes one arg; thinking still emitted).

- [ ] **Step 4: Honor the option.** In `part-stream-emitter.ts`, change the constructor and `onToolCall`:

```typescript
  constructor(private readonly messageId: string, private readonly opts: { showThinking?: boolean } = {}) {}
```

At the top of `onToolCall`, before opening any thinking part, add:

```typescript
    if (this.opts.showThinking === false) return [];
```

(Keep the existing `isFileGenTool` early-return after this — file-gen results still produce file parts regardless of thinking visibility, and they don't depend on the thinking branch.)

- [ ] **Step 5: Run it, expect pass.** `bunx vitest run libs/ai/src/part-stream-emitter.test.ts` → PASS (6 tests, including the prior 5).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma libs/ai/src/part-stream-emitter.ts libs/ai/src/part-stream-emitter.test.ts
git commit -m "feat: per-agent showThinking flag honored by PartStreamEmitter"
```

---

### Task 6: Wire `showThinking` into the inference route + agent update schema

**Files:**
- Modify: `apps/web-ui/app/api/v1/inference/route.ts`
- Modify: agent validation schema (find `updateAgentSchema` — `grep -rn "updateAgentSchema" libs/shared/src`)

- [ ] **Step 1: Pass the flag into the emitter.** In `route.ts`, the agent record is already loaded for the turn. At the `new PartStreamEmitter(messageId)` call (added in Phase 2), change to:

```typescript
            const emitter = new PartStreamEmitter(messageId, { showThinking: (agent as any)?.showThinking !== false });
```

(Default-on: only `false` suppresses. Use the loaded agent variable name in scope — `grep -n "findById\|agent" route.ts` to confirm; it's the `Agent` row loaded near the top of the handler.)

- [ ] **Step 2: Allow `showThinking` in agent updates.** In the file defining `updateAgentSchema`, add the optional field:

```typescript
  showThinking: z.boolean().optional(),
```

- [ ] **Step 3: Typecheck.** `bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | grep "inference/route"` → no NEW errors from these lines (the pre-existing `coreMessages` errors are unrelated and already present). `nx build shared` → clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/app/api/v1/inference/route.ts libs/shared/src
git commit -m "feat(api): honor agent.showThinking in inference stream and agent updates"
```

---

### Task 7: Workflow CRUD API routes

**Files:**
- Create: `apps/web-ui/app/api/agents/[id]/workflows/route.ts`
- Create: `apps/web-ui/app/api/agents/[id]/workflows/activate/route.ts`

Follow the exact convention from `apps/web-ui/app/api/agents/[id]/route.ts` (auth → authorize → Zod → service → JSON; 401/403/500).

- [ ] **Step 1: Create `workflows/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger, AgentWorkflowService, workflowDefinitionSchema } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:workflows');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;
    const { id } = await params;
    const svc = new AgentWorkflowService(tenantId, getPrismaClient() as any);
    const wf = await svc.getByAgent(id);
    return NextResponse.json(wf);
  } catch (error) {
    return handleErr(error, logger, 'get workflow');
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;
    const { id } = await params;
    const parsed = workflowDefinitionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid workflow' }, { status: 400 });
    }
    const svc = new AgentWorkflowService(tenantId, getPrismaClient() as any);
    const wf = await svc.upsert(id, parsed.data);
    logger.info({ tenantId, agentId: id }, 'Workflow saved');
    return NextResponse.json(wf);
  } catch (error) {
    return handleErr(error, logger, 'save workflow');
  }
}

function handleErr(error: unknown, log: ReturnType<typeof createLogger>, what: string) {
  if (error instanceof Error && error.message.includes('Unauthenticated')) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (error instanceof Error && error.message.includes('Unauthorized')) return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
  log.error({ error }, `Failed to ${what}`);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
```

- [ ] **Step 2: Create `workflows/activate/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger, AgentWorkflowService } from '@chatbot/shared';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:agents[id]:workflows:activate');
const bodySchema = z.object({ isActive: z.boolean() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;
    const { id } = await params;
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    const svc = new AgentWorkflowService(tenantId, getPrismaClient() as any);
    await svc.setActive(id, parsed.data.isActive);
    logger.info({ tenantId, agentId: id, isActive: parsed.data.isActive }, 'Workflow activation toggled');
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    if (error instanceof Error && error.message.includes('Unauthorized')) return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
    if (error instanceof Error && error.message.includes('No workflow')) return NextResponse.json({ error: error.message }, { status: 404 });
    logger.error({ error }, 'Failed to toggle activation');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Typecheck.** `bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | grep "workflows"` → no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web-ui/app/api/agents/[id]/workflows"
git commit -m "feat(api): add agent workflow CRUD + activate routes"
```

---

### Task 8: React Flow custom nodes + palette

**Files:**
- Create: `apps/web-ui/components/agents/workflow/workflow-node-types.tsx`
- Create: `apps/web-ui/components/agents/workflow/workflow-palette.tsx`

> Verified manually (no unit test). Build/typecheck is the gate.

- [ ] **Step 1: Create `workflow-node-types.tsx`** — three custom nodes. The menu node renders one `Handle` per option (handle `id` = option `value`).

```tsx
'use client';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { MenuOption } from '@chatbot/shared';

export function MenuNode({ data }: NodeProps) {
  const d = data as { title?: string; options?: MenuOption[] };
  return (
    <div className="rounded-lg border bg-card shadow-sm min-w-[180px]">
      <Handle type="target" position={Position.Left} />
      <div className="px-3 py-2 border-b text-sm font-semibold">{d.title || 'Menu'}</div>
      <div className="py-1">
        {(d.options ?? []).map((o) => (
          <div key={o.value} className="relative px-3 py-1.5 text-sm flex items-center justify-between">
            <span>{o.icon ? `${o.icon} ` : ''}{o.label}</span>
            <Handle type="source" id={o.value} position={Position.Right} style={{ position: 'relative', transform: 'none', right: -6 }} />
          </div>
        ))}
        {(d.options ?? []).length === 0 && <div className="px-3 py-1.5 text-xs text-muted-foreground">No options yet</div>}
      </div>
    </div>
  );
}

export function TextNode({ data }: NodeProps) {
  const d = data as { text?: string };
  return (
    <div className="rounded-lg border bg-card shadow-sm min-w-[160px] max-w-[240px]">
      <Handle type="target" position={Position.Left} />
      <div className="px-3 py-1 border-b text-xs font-medium text-muted-foreground">Text</div>
      <div className="px-3 py-2 text-sm whitespace-pre-wrap">{d.text || '(empty)'}</div>
    </div>
  );
}

export function FileNode({ data }: NodeProps) {
  const d = data as { fileRef?: string };
  return (
    <div className="rounded-lg border bg-card shadow-sm min-w-[160px]">
      <Handle type="target" position={Position.Left} />
      <div className="px-3 py-1 border-b text-xs font-medium text-muted-foreground">File</div>
      <div className="px-3 py-2 text-sm font-mono truncate">{d.fileRef || '(no file)'}</div>
    </div>
  );
}

export const workflowNodeTypes = { menu: MenuNode, text: TextNode, file: FileNode };
```

- [ ] **Step 2: Create `workflow-palette.tsx`** — drag sources (mirrors agent `NodePalette`'s `dataTransfer` key).

```tsx
'use client';
const ITEMS: { type: 'menu' | 'text' | 'file'; label: string }[] = [
  { type: 'menu', label: 'Menu' }, { type: 'text', label: 'Text' }, { type: 'file', label: 'File' },
];
export function WorkflowPalette() {
  return (
    <div className="w-40 border-r p-3 space-y-2">
      <div className="text-xs font-semibold text-muted-foreground uppercase">Nodes</div>
      {ITEMS.map((it) => (
        <div
          key={it.type}
          draggable
          onDragStart={(e) => e.dataTransfer.setData('application/workflow/type', it.type)}
          className="rounded-md border bg-card px-3 py-2 text-sm cursor-grab active:cursor-grabbing"
        >{it.label}</div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck.** `bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | grep "workflow-"` → no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/components/agents/workflow/workflow-node-types.tsx apps/web-ui/components/agents/workflow/workflow-palette.tsx
git commit -m "feat(web-ui): workflow canvas custom nodes and palette"
```

---

### Task 9: Node inspector panel

**Files:**
- Create: `apps/web-ui/components/agents/workflow/workflow-inspector.tsx`

> Verified manually. Build/typecheck is the gate. Edits the selected node's `data` via an `onChange` callback the canvas owns.

- [ ] **Step 1: Create `workflow-inspector.tsx`** using shadcn `Input`/`Textarea`/`Button`/`Label`.

```tsx
'use client';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { GraphNode, MenuOption } from '@chatbot/shared';

interface Props {
  node: GraphNode | null;
  onChange: (id: string, data: GraphNode['data']) => void;
  onClose: () => void;
}

export function WorkflowInspector({ node, onChange, onClose }: Props) {
  if (!node) return <div className="w-72 border-l p-4 text-sm text-muted-foreground">Select a node to edit.</div>;
  const d = node.data;
  const set = (patch: Partial<GraphNode['data']>) => onChange(node.id, { ...d, ...patch });

  return (
    <div className="w-72 border-l p-4 space-y-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold capitalize">{node.type} node</span>
        <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
      </div>

      {node.type === 'menu' && (
        <>
          <div className="space-y-1"><Label>Title</Label>
            <Input value={d.title ?? ''} onChange={(e) => set({ title: e.target.value })} /></div>
          <div className="space-y-2">
            <Label>Options</Label>
            {(d.options ?? []).map((o, i) => (
              <div key={i} className="flex gap-1">
                <Input placeholder="Label" value={o.label} onChange={(e) => {
                  const options = [...(d.options ?? [])]; options[i] = { ...o, label: e.target.value }; set({ options });
                }} />
                <Input placeholder="value" value={o.value} onChange={(e) => {
                  const options = [...(d.options ?? [])]; options[i] = { ...o, value: e.target.value }; set({ options });
                }} />
                <Button variant="ghost" size="sm" onClick={() => {
                  const options = (d.options ?? []).filter((_, j) => j !== i); set({ options });
                }}>×</Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => {
              const options: MenuOption[] = [...(d.options ?? []), { label: 'New', value: `opt_${(d.options ?? []).length + 1}` }]; set({ options });
            }}>+ Add option</Button>
          </div>
        </>
      )}

      {node.type === 'text' && (
        <div className="space-y-1"><Label>Text</Label>
          <Textarea value={d.text ?? ''} onChange={(e) => set({ text: e.target.value })} rows={5} /></div>
      )}

      {node.type === 'file' && (
        <div className="space-y-1"><Label>File reference</Label>
          <Input value={d.fileRef ?? ''} onChange={(e) => set({ fileRef: e.target.value })} placeholder="s3://… or /path" /></div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck.** `bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | grep "workflow-inspector"` → no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/components/agents/workflow/workflow-inspector.tsx
git commit -m "feat(web-ui): workflow node inspector panel"
```

---

### Task 10: Workflow canvas shell

**Files:**
- Create: `apps/web-ui/components/agents/workflow/workflow-canvas.tsx`

> Verified manually. This is the React Flow shell that loads/saves via the Task 7 routes and uses the Task 2 mapping. Models the agent-canvas pattern (`useNodesState`/`useEdgesState`, `addEdge` on connect, `dataTransfer` drop, `buildGraph` serialize).

- [ ] **Step 1: Create `workflow-canvas.tsx`**

```tsx
'use client';
import { useCallback, useRef, useState, useEffect } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, addEdge,
  useNodesState, useEdgesState, type Connection, type Node, type Edge, type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { graphToDefinition, definitionToGraph, validateGraph, type GraphNode } from '@chatbot/shared';
import { workflowNodeTypes } from './workflow-node-types';
import { WorkflowPalette } from './workflow-palette';
import { WorkflowInspector } from './workflow-inspector';
import { WorkflowPreviewDialog } from './workflow-preview-dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

function toGraphNode(n: Node): GraphNode {
  return { id: n.id, type: (n.type as GraphNode['type']) ?? 'text', position: n.position, data: n.data as GraphNode['data'] };
}

interface Props {
  agentId: string;
  initialActive: boolean;
  initialShowThinking: boolean;
}

export function WorkflowCanvas({ agentId, initialActive, initialShowThinking }: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActive] = useState(initialActive);
  const [showThinking, setShowThinking] = useState(initialShowThinking);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/agents/${agentId}/workflows`).then((r) => r.json()).then((wf) => {
      if (wf?.definition) {
        const g = definitionToGraph(wf.definition);
        setRfNodes(g.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })));
        setRfEdges(g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined })));
        setActive(!!wf.isActive);
      }
    }).catch(() => {});
  }, [agentId, setRfNodes, setRfEdges]);

  const onConnect: OnConnect = useCallback((c: Connection) => setRfEdges((eds) => addEdge(c, eds)), [setRfEdges]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/workflow/type') as GraphNode['type'];
    if (!type) return;
    const bounds = wrapper.current!.getBoundingClientRect();
    const position = { x: event.clientX - bounds.left - 90, y: event.clientY - bounds.top - 30 };
    const id = `${type}_${Date.now()}`;
    const data = type === 'menu' ? { title: 'Menu', options: [] } : type === 'text' ? { text: '' } : { fileRef: '' };
    setRfNodes((nds) => [...nds, { id, type, position, data }]);
  }, [setRfNodes]);

  const onInspectorChange = useCallback((id: string, data: GraphNode['data']) => {
    setRfNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data } : n)));
  }, [setRfNodes]);

  const buildGraph = useCallback(() => {
    const nodes = rfNodes.map(toGraphNode);
    const edges = rfEdges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null }));
    return { nodes, edges };
  }, [rfNodes, rfEdges]);

  const handleSave = useCallback(async () => {
    const { nodes, edges } = buildGraph();
    const errors = validateGraph(nodes, edges);
    if (errors.length) { toast.error(errors[0].message); return; }
    setSaving(true);
    try {
      const def = graphToDefinition(nodes, edges);
      const res = await fetch(`/api/agents/${agentId}/workflows`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(def) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      toast.success('Workflow saved');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }, [agentId, buildGraph]);

  const handleActivate = useCallback(async (next: boolean) => {
    setActive(next);
    const res = await fetch(`/api/agents/${agentId}/workflows/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: next }) });
    if (!res.ok) { setActive(!next); toast.error('Activation failed — save the workflow first'); }
    else toast.success(next ? 'Workflow active' : 'Workflow deactivated');
  }, [agentId]);

  const handleThinking = useCallback(async (next: boolean) => {
    setShowThinking(next);
    await fetch(`/api/agents/${agentId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ showThinking: next }) }).catch(() => {});
  }, [agentId]);

  const selectedNode = selectedId ? (rfNodes.find((n) => n.id === selectedId) as Node | undefined) : undefined;

  return (
    <div className="flex flex-col h-[70vh] border rounded-lg overflow-hidden">
      <div className="flex items-center gap-4 border-b px-4 py-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        <div className="flex items-center gap-2"><Switch checked={active} onCheckedChange={handleActivate} id="wf-active" /><Label htmlFor="wf-active">Active</Label></div>
        <div className="flex items-center gap-2"><Switch checked={showThinking} onCheckedChange={handleThinking} id="wf-think" /><Label htmlFor="wf-think">Show thinking</Label></div>
        <div className="ml-auto"><WorkflowPreviewDialog agentId={agentId} getDefinition={() => graphToDefinition(buildGraph().nodes, buildGraph().edges)} /></div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <WorkflowPalette />
        <div ref={wrapper} className="flex-1 relative" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}>
          <ReactFlow
            nodes={rfNodes} edges={rfEdges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)} onPaneClick={() => setSelectedId(null)}
            nodeTypes={workflowNodeTypes} fitView className="bg-muted/20"
          >
            <Background /><Controls /><MiniMap zoomable pannable />
          </ReactFlow>
        </div>
        <WorkflowInspector node={selectedNode ? toGraphNode(selectedNode) : null} onChange={onInspectorChange} onClose={() => setSelectedId(null)} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck.** `bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | grep "workflow-canvas"` → no errors (the preview dialog is created next; if it errors on the missing import, do Task 11 first then re-run — or stub the import). To avoid an ordering trap, create a minimal `workflow-preview-dialog.tsx` stub now and flesh it out in Task 11.

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/components/agents/workflow/workflow-canvas.tsx
git commit -m "feat(web-ui): workflow React Flow canvas with save/activate/thinking"
```

---

### Task 11: Preview dialog (mock-transport)

**Files:**
- Create: `apps/web-ui/components/agents/workflow/workflow-preview-dialog.tsx`

> Verified manually. Reuses the iframe + mock-transport approach from the designer page; renders the SDK widget so the author sees thinking/menu/file rendering without the live backend.

- [ ] **Step 1: Create `workflow-preview-dialog.tsx`.** Renders the widget in an iframe with `mock-scenario="menu"` (the closest mock to a workflow walk) and surfaces the authored definition as JSON for reference.

```tsx
'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { WorkflowDefinition } from '@chatbot/shared';

interface Props { agentId: string; getDefinition: () => WorkflowDefinition }

export function WorkflowPreviewDialog({ getDefinition }: Props) {
  const [open, setOpen] = useState(false);
  const [def, setDef] = useState<WorkflowDefinition | null>(null);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setDef(getDefinition()); }}>
      <DialogTrigger asChild><Button variant="outline" size="sm">Preview</Button></DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Workflow preview</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <iframe
            title="widget-preview"
            className="w-full h-[480px] border rounded"
            srcDoc={`<!DOCTYPE html><html><head><script type="module" src="/sdk-assets/smc-chat-widget.esm.js"><\/script><style>body{margin:0;background:#f9fafb}</style></head><body><smc-chat-widget sdk-id="preview" mock-scenario="menu" mock-config='${JSON.stringify({ apiKeyPrefix: 'preview', primaryColor: '#4f46e5', secondaryColor: '#06b6d4', position: 'right', theme: 'light', botName: 'Preview', welcomeMessage: 'Send a message to walk the menu.' })}'></smc-chat-widget></body></html>`}
          />
          <pre className="text-xs overflow-auto h-[480px] bg-muted/30 rounded p-3">{JSON.stringify(def, null, 2)}</pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck + build.** `bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | grep "workflow-"` → no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/components/agents/workflow/workflow-preview-dialog.tsx
git commit -m "feat(web-ui): workflow preview dialog via mock-transport widget"
```

---

### Task 12: Mount the "Workflow" tab on the agent edit page

**Files:**
- Modify: `apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx`

- [ ] **Step 1: Read the page's tab structure.** `grep -n "TabsTrigger\|TabsContent\|TabsList\|value=" apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx` to find the exact tab pattern + how `agent` (with `showThinking`) is loaded.

- [ ] **Step 2: Add the tab.** Add a `TabsTrigger value="workflow"` to the `TabsList` and a matching `TabsContent`:

```tsx
<TabsContent value="workflow">
  <WorkflowCanvas
    agentId={agent.id}
    initialActive={false}
    initialShowThinking={agent.showThinking !== false}
  />
</TabsContent>
```

Add the import at top: `import { WorkflowCanvas } from '@/components/agents/workflow/workflow-canvas';` (dynamic import with `ssr:false` if the page is a server component — React Flow is client-only; follow how the existing `AgentCanvas` is imported on this page).

- [ ] **Step 3: Typecheck + manual check.** `bunx tsc --noEmit -p apps/web-ui/tsconfig.json` → no NEW errors. Then `bun run dev`, open an agent's edit page → Workflow tab: drag a Menu + Text node, add an option, connect option→text, Save (toast), toggle Active, toggle Show thinking, open Preview.

- [ ] **Step 4: Commit**

```bash
git add "apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx"
git commit -m "feat(web-ui): add Workflow tab to agent edit page"
```

---

### Task 13: Final verification + spec self-review

- [ ] **Step 1: Run all affected lib tests.** `bunx vitest run libs/shared/src/workflow libs/shared/src/services/agent-workflow-service.test.ts libs/ai/src/part-stream-emitter.test.ts` → all green (Tasks 2,3,5).

- [ ] **Step 2: Build libs + web-ui.** `nx build shared && nx build ai && nx build web-ui` → no errors.

- [ ] **Step 3: Manual end-to-end** (local DB + `bun run dev`): author a 2-step menu workflow for an agent, Save, Activate. Then hit `/api/v1/inference?format=sse` for that agent with the entry value and confirm the workflow node's parts stream back; toggle Show thinking off and confirm an LLM-path turn emits no thinking events.

- [ ] **Step 4: Spec self-review** against `docs/superpowers/specs/2026-05-31-chat-widget-designer-design.md` §1–§9. Confirm each DoD item (§8):
  - [ ] Workflow tab renders a React Flow canvas authoring menu/text/file + option→node transitions.
  - [ ] `graph ↔ WorkflowDefinition` is pure + unit-tested; round-trips losslessly.
  - [ ] Service + routes persist/activate one workflow per agent; PUT validated by `workflowDefinitionSchema`.
  - [ ] Activate toggle makes a workflow live (engine reads `isActive`).
  - [ ] `showThinking` authored, persisted on `Agent`, honored by `PartStreamEmitter` (off → no thinking events, text at index 0).
  - [ ] Live preview renders the widget via mock transport.
  - [ ] Client + server validation block a malformed workflow.
  - [ ] Mapping/service/emitter units green; canvas verified manually.

---

## Out of scope (deferred)
- Versioned workflow history / multiple workflows per agent (version stays 1).
- Dynamic per-node signed file URLs (static `fileRef` only).
- Image-output authoring.
- Full live-backend preview (mock-transport preview only).
- Unit tests for interactive canvas behavior (manual/e2e by design).

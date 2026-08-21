# Claw on DeepAgents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `libs/claw-studio/src/agent/claw-graph.ts` — 930 lines of hand-written LangGraph `StateGraph` — with `createDeepAgent`, so no orchestration graph is maintained by hand.

**Architecture:** `createDeepAgent` takes model, tools, middleware, backend, checkpointer and `interruptOn` as parameters. Claw's six workspace files are exposed to it through a custom `BackendProtocolV2` implemented over the existing `WorkspaceFileService`. Claw's pgvector semantic memory has no deepagents equivalent and is carried across as custom middleware wrapping the loop. The task path (`planner → generate → tools → reflect → revise → final`) is replaced; memory and routing behaviour is preserved.

**Tech Stack:** TypeScript, `deepagents@1.12.2`, `langchain@1.5.3`, `@langchain/langgraph@1.4.8` (transitive — deepagents compiles to a LangGraph graph), Prisma + pgvector, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-08-deepagents-migration-design.md`

## Global Constraints

- **Branch discipline.** This is the DeepAgents half of a two-branch experiment. The LangGraph implementation stays on its own branch. Do **not** add a runtime switch, executor interface, or dual-path code.
- **Scope: task path only.** `memory_recall`, `evaluator`, `clarify`, `respond`, `memory_save` keep their current behaviour. Memory moves from nodes to middleware but calls the same service at the same points.
- **Do not modify** the 37 files in `libs/claw-studio/src/integrations/`, the memory system (`memory-service.ts`, `memory-nodes.ts`, `embeddings.ts`, `reconcile.ts`, `skill-synthesis.ts`), `workspace-file-service.ts`, `tool-classifier.ts`, the scheduler, or `model-factory.ts`.
- **Do not change `DEFAULT_IDENTITY`.** `prompt-composer.test.ts` and `prompt-templates.test.ts` pin the non-regression guarantee: a tenant with no workspace files must compose to `''` and fall back to `DEFAULT_IDENTITY`.
- **Tests run from the library root:** `cd libs/claw-studio && bunx vitest run`. The vitest `include` is relative to that directory; running from the repo root finds nothing.
- **`vi.mock` does not reliably intercept relative-module imports in this package** — a verified pre-existing environment issue. Several existing tests are integration-style against the real local Postgres. Follow the existing pattern rather than fighting it.
- **Tools never throw.** A thrown LangChain tool error aborts the whole run. Every failure path returns a recoverable string. Same convention applies to backend methods, which return `{ error }` rather than throwing.
- **Typecheck:** `cd libs/claw-studio && bunx tsc --noEmit -p tsconfig.lib.json`.
  **NOT `-p tsconfig.json`** — that is a solution-style config with `include: []`,
  `files: []` and a reference to `tsconfig.lib.json`. It checks ZERO files and exits 0,
  which silently rubber-stamped Tasks 2-7. Verify with `--listFiles | grep -c src`.
- **Never use `prisma migrate dev`** in this repo — it wants to reset the database and the drift it reports is by design. No migrations are needed for this plan.

---

### Task 1: Add dependencies and prove `createDeepAgent` accepts a custom backend

The spec's original Risk #1 (reusing deepagents' `StoreBackend` over `PostgresMemoryStore`) was disproven during planning — that store writes embedded SEMANTIC memories into `claw_memories` and is the wrong abstraction. The replacement design implements `BackendProtocolV2` directly. This task proves that a hand-written backend is accepted, and checks whether `REQUIRED_MIDDLEWARE_NAMES` forces deepagents' own filesystem middleware on. Everything else depends on this answer.

**Files:**
- Modify: `package.json` (root, dependencies block)
- Create: `libs/claw-studio/src/agent/deepagents-contract.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a proven-callable `createDeepAgent({ model, tools, backend, checkpointer, interruptOn, middleware })`, and a recorded answer on forced middleware.

- [ ] **Step 1: Install the dependencies**

```bash
cd /Users/H2952/Documents/chatflow
bun add deepagents@1.12.2 langsmith
```

`langsmith` is a declared peer dependency of `deepagents` and is the only one not already satisfied. Verify the rest are unchanged:

```bash
for p in langchain @langchain/core @langchain/langgraph @langchain/langgraph-checkpoint-postgres; do
  echo "$p $(cat node_modules/$p/package.json | python3 -c "import sys,json;print(json.load(sys.stdin)['version'])")"
done
```

Expected: `langchain 1.5.3`, `@langchain/core 1.2.3`, `@langchain/langgraph 1.4.8`, `@langchain/langgraph-checkpoint-postgres 1.0.4`.

- [ ] **Step 2: Write the failing contract test**

Create `libs/claw-studio/src/agent/deepagents-contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDeepAgent, REQUIRED_MIDDLEWARE_NAMES } from 'deepagents';
import type { BackendProtocolV2 } from 'deepagents';
import { FakeListChatModel } from '@langchain/core/utils/testing';

/** Minimal BackendProtocolV2 — proves a hand-written backend is accepted. */
class StubBackend implements BackendProtocolV2 {
  async ls() { return { files: [{ path: '/a.md', is_dir: false }] }; }
  async read() { return { content: 'hello' }; }
  async readRaw() { return { content: 'hello' }; }
  async write() { return { path: '/a.md' }; }
  async grep() { return { matches: [] }; }
  async glob() { return { files: [] }; }
  async execute() { return { output: '', exitCode: 0, truncated: false }; }
}

describe('deepagents contract', () => {
  it('accepts a hand-written BackendProtocolV2', () => {
    const agent = createDeepAgent({
      model: new FakeListChatModel({ responses: ['ok'] }),
      tools: [],
      backend: new StubBackend(),
    });
    expect(agent).toBeDefined();
    expect(typeof agent.stream).toBe('function');
    expect(typeof agent.invoke).toBe('function');
  });

});
```

Note the import line drops `REQUIRED_MIDDLEWARE_NAMES` — it is read in Step 3
by inspection, not by a test:

```ts
import { createDeepAgent } from 'deepagents';
```

- [ ] **Step 3: Run the test, then inspect the forced-middleware list**

```bash
cd libs/claw-studio && bunx vitest run src/agent/deepagents-contract.test.ts
```

Expected: PASS.

If it fails on the `backend` type, the backend shape is wrong — read `node_modules/deepagents/dist/agent-*.d.ts`, find `interface BackendProtocolV2`, and match it exactly. **Do not proceed past this task until it passes**; every later task assumes a custom backend is accepted.

Then read `REQUIRED_MIDDLEWARE_NAMES` by inspection — Task 4 needs to know whether deepagents forces its filesystem middleware on. This is a one-off read, not a test, so it does not enter the codebase:

```bash
cd /Users/H2952/Documents/chatflow
node -e "import('deepagents').then(m => console.log('REQUIRED_MIDDLEWARE_NAMES =', JSON.stringify(m.REQUIRED_MIDDLEWARE_NAMES)))"
```

Put the printed value verbatim in your report file — the controller records it in the ledger for Task 4.

- [ ] **Step 4: Commit**

```bash
cd /Users/H2952/Documents/chatflow
git add package.json bun.lock libs/claw-studio/src/agent/deepagents-contract.test.ts
git commit -m "test(claw-studio): pin deepagents backend + required-middleware contract"
```

---

### Task 2: `ClawWorkspaceBackend` — `BackendProtocolV2` over `WorkspaceFileService`

Exposes Claw's six DB-backed workspace files to deepagents as files, preserving revisions and audit.

**Files:**
- Create: `libs/claw-studio/src/agent/workspace-backend.ts`
- Test: `libs/claw-studio/src/agent/workspace-backend.test.ts`

**Interfaces:**
- Consumes: `WorkspaceFileService` from `../workspace/workspace-file-service` — `read(slug): Promise<WorkspaceFile | null>`, `write(slug, content, { updatedBy, reason?, sourceRunId? }): Promise<WorkspaceFile>`, `list(): Promise<WorkspaceFile[]>`. `WorkspaceSlug`, `WORKSPACE_SLUGS`, `SLUG_CHAR_CAPS`, `isWorkspaceSlug` from `../workspace/types`.
- Produces: `class ClawWorkspaceBackend implements BackendProtocolV2`, constructor `(service: WorkspaceFileService, opts?: { sourceRunId?: string })`; and `pathToSlug(path: string): WorkspaceSlug | null`, `slugToPath(slug: WorkspaceSlug): string`.

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/agent/workspace-backend.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ClawWorkspaceBackend, pathToSlug, slugToPath } from './workspace-backend';
import type { WorkspaceSlug } from '../workspace/types';

/** Hand-rolled fake — vi.mock does not reliably intercept relative imports here. */
function fakeService(initial: Partial<Record<WorkspaceSlug, string>> = {}) {
  const store = new Map<WorkspaceSlug, string>(Object.entries(initial) as [WorkspaceSlug, string][]);
  const writes: Array<{ slug: WorkspaceSlug; content: string; options: unknown }> = [];
  return {
    writes,
    async read(slug: WorkspaceSlug) {
      const content = store.get(slug);
      return content === undefined ? null : { slug, content, version: 1 };
    },
    async write(slug: WorkspaceSlug, content: string, options: unknown) {
      store.set(slug, content);
      writes.push({ slug, content, options });
      return { slug, content, version: 2 };
    },
    async list() {
      return [...store.entries()].map(([slug, content]) => ({ slug, content, version: 1 }));
    },
  };
}

describe('path mapping', () => {
  it('maps a slug to a path and back', () => {
    expect(slugToPath('soul')).toBe('/soul.md');
    expect(pathToSlug('/soul.md')).toBe('soul');
  });

  it('rejects a path that is not a workspace slug', () => {
    expect(pathToSlug('/etc/passwd')).toBeNull();
    expect(pathToSlug('/nope.md')).toBeNull();
  });
});

describe('ClawWorkspaceBackend', () => {
  let svc: ReturnType<typeof fakeService>;
  let backend: ClawWorkspaceBackend;

  beforeEach(() => {
    svc = fakeService({ soul: 'I am curious.', identity: 'Claw' });
    backend = new ClawWorkspaceBackend(svc as never, { sourceRunId: 'run_1' });
  });

  it('reads a workspace file by path', async () => {
    expect(await backend.read('/soul.md')).toEqual({ content: 'I am curious.' });
  });

  it('returns an error object rather than throwing for an unknown path', async () => {
    const result = await backend.read('/etc/passwd');
    expect(result.error).toContain('not a Claw workspace file');
    expect(result.content).toBeUndefined();
  });

  it('writes through to the service with audit metadata', async () => {
    const result = await backend.write('/soul.md', 'I am bold.');
    expect(result).toEqual({ path: '/soul.md' });
    expect(svc.writes[0]).toMatchObject({
      slug: 'soul',
      content: 'I am bold.',
      options: { updatedBy: 'claw', sourceRunId: 'run_1' },
    });
  });

  it('rejects content over the slug cap without throwing', async () => {
    const result = await backend.write('/identity.md', 'x'.repeat(2001));
    expect(result.error).toContain('exceeds');
    expect(svc.writes).toHaveLength(0);
  });

  it('lists only files that exist', async () => {
    const result = await backend.ls('/');
    expect(result.files?.map((f) => f.path).sort()).toEqual(['/identity.md', '/soul.md']);
  });

  it('greps across workspace files', async () => {
    const result = await backend.grep('curious');
    expect(result.matches?.[0]).toMatchObject({ path: '/soul.md' });
  });

  it('reports execute as unsupported instead of throwing', async () => {
    const result = await backend.execute('ls');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('not supported');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd libs/claw-studio && bunx vitest run src/agent/workspace-backend.test.ts
```

Expected: FAIL — `Cannot find module './workspace-backend'`.

- [ ] **Step 3: Implement the backend**

Create `libs/claw-studio/src/agent/workspace-backend.ts`:

```ts
/**
 * workspace-backend.ts — exposes Claw's six DB-backed workspace files to
 * deepagents as a filesystem.
 *
 * Deliberately NOT deepagents' own `StoreBackend`: that requires a LangGraph
 * `BaseStore`, and this codebase's `PostgresMemoryStore` implements a local
 * `MemoryStoreInterface` whose `batch()` writes embedded SEMANTIC rows into
 * `claw_memories`. Routing files through it would embed every write, pollute
 * the memory table, and bypass `claw_workspace_files` entirely. Implementing
 * the protocol directly over `WorkspaceFileService` keeps rows as rows and
 * preserves `ClawFileRevision` audit.
 *
 * Every method returns an error object rather than throwing: a thrown error
 * inside the agent loop aborts the whole run.
 */
import type { BackendProtocolV2, ExecuteResponse, FileInfo, GlobResult, GrepResult, LsResult, ReadResult, WriteResult } from 'deepagents';
import type { WorkspaceFileService } from '../workspace/workspace-file-service';
import { SLUG_CHAR_CAPS, WORKSPACE_SLUGS, isWorkspaceSlug, type WorkspaceSlug } from '../workspace/types';
import { createLogger } from '@chatbot/shared';

const logger = createLogger('claw-studio:workspace-backend');

export function slugToPath(slug: WorkspaceSlug): string {
  return `/${slug}.md`;
}

export function pathToSlug(path: string): WorkspaceSlug | null {
  const name = path.replace(/^\/+/, '').replace(/\.md$/i, '');
  return isWorkspaceSlug(name) ? name : null;
}

const UNKNOWN = (path: string) =>
  `"${path}" is not a Claw workspace file. Available: ${WORKSPACE_SLUGS.map(slugToPath).join(', ')}`;

export class ClawWorkspaceBackend implements BackendProtocolV2 {
  constructor(
    private readonly service: WorkspaceFileService,
    private readonly opts: { sourceRunId?: string } = {},
  ) {}

  async read(filePath: string): Promise<ReadResult> {
    const slug = pathToSlug(filePath);
    if (!slug) return { error: UNKNOWN(filePath) };
    try {
      const file = await this.service.read(slug);
      if (!file) return { error: `"${filePath}" has no content yet.` };
      return { content: file.content };
    } catch (err) {
      logger.warn({ filePath, err }, 'workspace read failed');
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async readRaw(filePath: string): Promise<ReadResult> {
    return this.read(filePath);
  }

  async write(filePath: string, content: string): Promise<WriteResult> {
    const slug = pathToSlug(filePath);
    if (!slug) return { error: UNKNOWN(filePath) };
    const cap = SLUG_CHAR_CAPS[slug];
    if (content.length > cap) {
      return { error: `${filePath} exceeds its ${cap}-character cap (got ${content.length}).` };
    }
    try {
      await this.service.write(slug, content, {
        updatedBy: 'claw',
        reason: 'agent write',
        sourceRunId: this.opts.sourceRunId,
      });
      return { path: filePath };
    } catch (err) {
      logger.warn({ filePath, err }, 'workspace write failed');
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async ls(_path?: string): Promise<LsResult> {
    try {
      const files = await this.service.list();
      const infos: FileInfo[] = files
        .filter((f) => f.content && f.content.length > 0)
        .map((f) => ({ path: slugToPath(f.slug), is_dir: false, size: f.content.length }));
      return { files: infos };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async glob(pattern: string, _path?: string): Promise<GlobResult> {
    const ls = await this.ls();
    if (ls.error) return { error: ls.error };
    // The namespace is six fixed files; a substring match is sufficient and
    // avoids pulling in a glob dependency for a closed set.
    const needle = pattern.replace(/[*?]/g, '');
    return { files: (ls.files ?? []).filter((f) => f.path.includes(needle)) };
  }

  async grep(pattern: string, _path?: string | null, _glob?: string | null): Promise<GrepResult> {
    try {
      const files = await this.service.list();
      const matches = [] as NonNullable<GrepResult['matches']>;
      for (const file of files) {
        const lines = (file.content ?? '').split('\n');
        lines.forEach((line, i) => {
          if (line.includes(pattern)) {
            matches.push({ path: slugToPath(file.slug), line_number: i + 1, line } as never);
          }
        });
      }
      return { matches };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async execute(_command: string): Promise<ExecuteResponse> {
    return {
      output: 'Shell execution is not supported against the Claw workspace backend.',
      exitCode: 1,
      truncated: false,
    };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd libs/claw-studio && bunx vitest run src/agent/workspace-backend.test.ts
```

Expected: PASS (9 tests).

If `GrepMatch`'s real field names differ from `path`/`line_number`/`line`, read them from `node_modules/deepagents/dist/agent-*.d.ts` (`interface GrepMatch`) and fix both the implementation and the test's `toMatchObject`.

- [ ] **Step 5: Typecheck and commit**

```bash
cd libs/claw-studio && bunx tsc --noEmit -p tsconfig.lib.json
cd /Users/H2952/Documents/chatflow
git add libs/claw-studio/src/agent/workspace-backend.ts libs/claw-studio/src/agent/workspace-backend.test.ts
git commit -m "feat(claw-studio): expose workspace files to deepagents via BackendProtocolV2"
```

---

### Task 3: Memory middleware

deepagents has no semantic memory. `memory_recall` and `memory_save` move from graph nodes to middleware hooks, calling the same node factories unchanged.

**Files:**
- Create: `libs/claw-studio/src/memory/memory-middleware.ts`
- Test: `libs/claw-studio/src/memory/memory-middleware.test.ts`

**Interfaces:**
- Consumes: `createMemoryRecallNode(deps)` returning `(state: MemoryNodeState) => Promise<{ memoryContext: string; memoryStats: MemoryRecallStats | null }>` and `createMemorySaveNode(deps)` returning `(state: MemoryNodeState, runtimeConfig?: any) => Promise<{ memoryStats: MemorySaveStats | null }>`, both from `./memory-nodes`. `deps` shape: `{ reflectorModel: BaseChatModel; tenantId?: string; userId?: string; store: unknown | null }`.
- Produces: `createClawMemoryMiddleware(deps: ClawMemoryDeps)` returning an `AgentMiddleware`, and `ClawMemoryDeps`.

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/memory/memory-middleware.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createClawMemoryMiddleware } from './memory-middleware';

describe('createClawMemoryMiddleware', () => {
  it('recalls before the model runs and injects context', async () => {
    const recall = vi.fn().mockResolvedValue({ memoryContext: 'REMEMBERED', memoryStats: null });
    const save = vi.fn().mockResolvedValue({ memoryStats: null });
    const mw = createClawMemoryMiddleware({ recallNode: recall, saveNode: save });

    const state = { messages: [{ _getType: () => 'human', content: 'hi' }] };
    const patch = await mw.beforeModel!(state as never, {} as never);

    expect(recall).toHaveBeenCalledOnce();
    expect(JSON.stringify(patch)).toContain('REMEMBERED');
  });

  it('saves after the turn completes', async () => {
    const recall = vi.fn().mockResolvedValue({ memoryContext: '', memoryStats: null });
    const save = vi.fn().mockResolvedValue({ memoryStats: null });
    const mw = createClawMemoryMiddleware({ recallNode: recall, saveNode: save });

    await mw.afterAgent!({ messages: [] } as never, { configurable: { thread_id: 't1' } } as never);
    expect(save).toHaveBeenCalledOnce();
  });

  it('never throws when recall fails — memory is non-fatal', async () => {
    const recall = vi.fn().mockRejectedValue(new Error('pgvector down'));
    const save = vi.fn().mockResolvedValue({ memoryStats: null });
    const mw = createClawMemoryMiddleware({ recallNode: recall, saveNode: save });

    await expect(mw.beforeModel!({ messages: [] } as never, {} as never)).resolves.not.toThrow();
  });

  it('never throws when save fails', async () => {
    const recall = vi.fn().mockResolvedValue({ memoryContext: '', memoryStats: null });
    const save = vi.fn().mockRejectedValue(new Error('boom'));
    const mw = createClawMemoryMiddleware({ recallNode: recall, saveNode: save });

    await expect(mw.afterAgent!({ messages: [] } as never, {} as never)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd libs/claw-studio && bunx vitest run src/memory/memory-middleware.test.ts
```

Expected: FAIL — `Cannot find module './memory-middleware'`.

- [ ] **Step 3: Implement the middleware**

Create `libs/claw-studio/src/memory/memory-middleware.ts`:

```ts
/**
 * memory-middleware.ts — carries Claw's pgvector memory across to the
 * deepagents loop. deepagents' own `createMemoryMiddleware` loads prompt files;
 * it has no embeddings or vector recall, so it is not a substitute.
 *
 * Recall runs before the model and injects context; save runs after the turn.
 * Both wrap the existing node factories unchanged, so the reconcile judge,
 * episodic capture and skill synthesis all keep firing from the save path.
 *
 * Memory failure is non-fatal, matching the graph: a failed embedding degrades
 * to recency text search rather than aborting the run.
 */
import { createLogger } from '@chatbot/shared';

const logger = createLogger('claw-studio:memory-middleware');

type RecallNode = (state: unknown) => Promise<{ memoryContext: string; memoryStats: unknown }>;
type SaveNode = (state: unknown, runtimeConfig?: unknown) => Promise<{ memoryStats: unknown }>;

export interface ClawMemoryDeps {
  recallNode: RecallNode;
  saveNode: SaveNode;
}

export function createClawMemoryMiddleware(deps: ClawMemoryDeps) {
  return {
    name: 'clawMemory',

    async beforeModel(state: unknown, _runtime: unknown) {
      try {
        const { memoryContext } = await deps.recallNode(state);
        if (!memoryContext) return undefined;
        return { memoryContext };
      } catch (err) {
        logger.warn({ err }, '[memory] recall failed — continuing without context');
        return undefined;
      }
    },

    async afterAgent(state: unknown, runtime: unknown) {
      try {
        await deps.saveNode(state, runtime);
      } catch (err) {
        logger.warn({ err }, '[memory] save failed — run already answered');
      }
      return undefined;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd libs/claw-studio && bunx vitest run src/memory/memory-middleware.test.ts
```

Expected: PASS (4 tests).

If deepagents' `AgentMiddleware` uses different hook names than `beforeModel`/`afterAgent`, read them from `node_modules/deepagents/dist/agent-*.d.ts` (search `AgentMiddleware`) and rename in both files. The hook *semantics* required are: one that runs before each model call, one that runs once after the agent finishes.

- [ ] **Step 5: Commit**

```bash
cd /Users/H2952/Documents/chatflow
git add libs/claw-studio/src/memory/memory-middleware.ts libs/claw-studio/src/memory/memory-middleware.test.ts
git commit -m "feat(claw-studio): carry pgvector memory across as deepagents middleware"
```

---

### Task 4: `claw-deep-agent.ts` — the composition root

Replaces `createClawGraph`. Reuses `buildInterruptOn` and the prompt composition from the `claw-agent.ts` spike before that file is deleted in Task 9.

**Files:**
- Create: `libs/claw-studio/src/agent/claw-deep-agent.ts`
- Test: `libs/claw-studio/src/agent/claw-deep-agent.test.ts`

**Interfaces:**
- Consumes: `ClawWorkspaceBackend` (Task 2); `createClawMemoryMiddleware` (Task 3); `buildInterruptOn(tools, { granted, policyMode })` from `./claw-agent` — copy its body into this file, do not import, since Task 9 deletes it; `composeIdentity({ files, surface, agentsOverride })` from `./prompt-composer`; `buildBaseIdentity(selectedSkill, composed)` and `CORE_PRINCIPLES` from `./prompt-templates`.
- Produces: `createClawDeepAgent(deps: ClawDeepAgentDeps)` returning the compiled agent, and `buildInterruptOn` re-exported from here.

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/agent/claw-deep-agent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createClawDeepAgent, buildInterruptOn } from './claw-deep-agent';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const readTool = tool(async () => 'ok', {
  name: 'get_weather',
  description: 'read only',
  schema: z.object({}),
});
const writeTool = tool(async () => 'ok', {
  name: 'jira_create_issue',
  description: 'mutative',
  schema: z.object({}),
});

describe('buildInterruptOn', () => {
  it('gates a mutative tool and lets a read-only tool through', () => {
    const map = buildInterruptOn([readTool, writeTool], { granted: new Set(), policyMode: 'ask' });
    expect(map['get_weather']).toBe(false);
    expect(map['jira_create_issue']).toEqual({ allowedDecisions: ['approve', 'edit', 'reject'] });
  });

  it('exempts a granted tool', () => {
    const map = buildInterruptOn([writeTool], { granted: new Set(['jira_create_issue']), policyMode: 'ask' });
    expect(map['jira_create_issue']).toBe(false);
  });

  it("auto-approves everything under policyMode 'all'", () => {
    const map = buildInterruptOn([writeTool], { granted: new Set(), policyMode: 'all' });
    expect(map['jira_create_issue']).toBe(false);
  });
});

describe('createClawDeepAgent', () => {
  it('builds an agent exposing stream and invoke', () => {
    const agent = createClawDeepAgent({
      model: new FakeListChatModel({ responses: ['done'] }),
      tools: [readTool],
      tenantId: 't1',
      userId: 'claw_1',
    });
    expect(typeof agent.stream).toBe('function');
    expect(typeof agent.invoke).toBe('function');
  });

  it('composes to DEFAULT_IDENTITY when there are no workspace files', () => {
    // Non-regression guarantee pinned by prompt-composer.test.ts.
    const agent = createClawDeepAgent({
      model: new FakeListChatModel({ responses: ['done'] }),
      tools: [],
      workspaceFiles: new Map(),
      tenantId: 't1',
      userId: 'claw_1',
    });
    expect(agent).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd libs/claw-studio && bunx vitest run src/agent/claw-deep-agent.test.ts
```

Expected: FAIL — `Cannot find module './claw-deep-agent'`.

- [ ] **Step 3: Implement the composition root**

Create `libs/claw-studio/src/agent/claw-deep-agent.ts`:

```ts
/**
 * claw-deep-agent.ts — Claw's task path as a deepagents loop, replacing the
 * hand-written StateGraph in claw-graph.ts.
 *
 * Planning is `write_todos`, a tool the model reaches for when the work is
 * complex, rather than a node every turn pays for. There is no reflect/revise
 * cycle — the loop iterates on its own.
 *
 * `buildInterruptOn` is copied here from the deleted claw-agent.ts spike so
 * this file has no dependency on it.
 */
import { createDeepAgent } from 'deepagents';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { createLogger } from '@chatbot/shared';
import { classifyTool } from './tool-classifier';
import { composeIdentity, type PromptSurface } from './prompt-composer';
import { buildBaseIdentity, CORE_PRINCIPLES } from './prompt-templates';
import type { WorkspaceSlug } from '../workspace/types';
import type { ApprovalMode } from '../scheduler/types';

const logger = createLogger('claw-studio:claw-deep-agent');

const DEFAULT_MODEL_CALL_LIMIT = 12;

export interface ClawDeepAgentDeps {
  model: BaseChatModel;
  tools?: StructuredToolInterface[];
  workspaceFiles?: Map<WorkspaceSlug, string>;
  /** Overrides the `agents` workspace file for this run only. */
  systemPrompt?: string;
  promptSurface?: PromptSurface;
  /** Held BY REFERENCE — file-tools populates it lazily as free-slug writes happen. */
  grantedTools?: Set<string>;
  approvalPolicy?: { mode: ApprovalMode; allowedTools?: string[] };
  autoApprove?: boolean;
  checkpointer?: BaseCheckpointSaver;
  /** BackendProtocolV2 instance — Claw's workspace files. */
  backend?: unknown;
  /** Extra middleware, e.g. the memory middleware from Task 3. */
  middleware?: unknown[];
  modelCallLimit?: number;
  tenantId?: string;
  userId?: string;
}

export function buildInterruptOn(
  tools: StructuredToolInterface[],
  opts: { granted: Set<string>; policyMode: ApprovalMode },
): Record<string, boolean | { allowedDecisions: Array<'approve' | 'edit' | 'reject'> }> {
  const interruptOn: Record<string, boolean | { allowedDecisions: Array<'approve' | 'edit' | 'reject'> }> = {};
  for (const tool of tools) {
    const name = tool.name;
    if (opts.policyMode === 'all' || opts.granted.has(name)) {
      interruptOn[name] = false;
      continue;
    }
    // Classified without args — args-sensitive tools still gate, which is the
    // safe direction (over-asking, never under-asking).
    const { isMutative } = classifyTool(name);
    interruptOn[name] = isMutative ? { allowedDecisions: ['approve', 'edit', 'reject'] } : false;
  }
  return interruptOn;
}

export function createClawDeepAgent(deps: ClawDeepAgentDeps) {
  const {
    model, tools = [], workspaceFiles, systemPrompt, promptSurface,
    grantedTools, approvalPolicy, autoApprove = false, checkpointer,
    backend, middleware = [], modelCallLimit = DEFAULT_MODEL_CALL_LIMIT,
    tenantId, userId,
  } = deps;

  const policyMode: ApprovalMode = autoApprove ? 'all' : (approvalPolicy?.mode ?? 'ask');
  const granted = grantedTools ?? new Set<string>();
  for (const name of approvalPolicy?.allowedTools ?? []) granted.add(name);

  const composed = composeIdentity({
    files: workspaceFiles ?? new Map<WorkspaceSlug, string>(),
    surface: promptSurface ?? 'acting',
    agentsOverride: systemPrompt,
  });
  const prompt = `${buildBaseIdentity(null, composed)}\n${CORE_PRINCIPLES}`;

  const interruptOn = buildInterruptOn(tools, { granted, policyMode });

  logger.info(
    { tenantId, userId, tools: tools.length, gated: Object.values(interruptOn).filter(Boolean).length, policyMode, modelCallLimit },
    '[claw-deep-agent] building agent',
  );

  return createDeepAgent({
    model,
    tools,
    systemPrompt: prompt,
    interruptOn,
    ...(backend ? { backend } : {}),
    ...(middleware.length ? { middleware } : {}),
    ...(checkpointer ? { checkpointer } : {}),
  } as never);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd libs/claw-studio && bunx vitest run src/agent/claw-deep-agent.test.ts
```

Expected: PASS (5 tests).

If `createDeepAgent` rejects `interruptOn` or `systemPrompt` at runtime, read `interface CreateDeepAgentParams` in `node_modules/deepagents/dist/agent-*.d.ts` and correct the option names. If `REQUIRED_MIDDLEWARE_NAMES` (recorded in Task 1) forces deepagents' filesystem middleware, pass the `ClawWorkspaceBackend` as `backend` — the forced middleware will route through it, which is the desired behaviour.

- [ ] **Step 5: Typecheck and commit**

```bash
cd libs/claw-studio && bunx tsc --noEmit -p tsconfig.lib.json
cd /Users/H2952/Documents/chatflow
git add libs/claw-studio/src/agent/claw-deep-agent.ts libs/claw-studio/src/agent/claw-deep-agent.test.ts
git commit -m "feat(claw-studio): add deepagents composition root replacing createClawGraph"
```

---

### Task 5: Wire `claw-runtime.ts` to build the agent

**Files:**
- Modify: `libs/claw-studio/src/agent/claw-runtime.ts` (the `createClawGraph({...})` call at lines 206-222 and the return at 224-234)
- Test: `libs/claw-studio/src/agent/claw-runtime.test.ts` (existing — extend)

**Interfaces:**
- Consumes: `createClawDeepAgent` (Task 4), `ClawWorkspaceBackend` (Task 2), `createClawMemoryMiddleware` (Task 3), `createMemoryRecallNode`/`createMemorySaveNode` from `../memory/memory-nodes`.
- Produces: `ClawRuntime.graph` now holds the deepagents agent. The field keeps the name `graph` so the three consumers in Task 6-8 need no rename. `config` keeps its exact shape: `{ configurable: { thread_id, tenant_id, user_id }, recursionLimit }`.

- [ ] **Step 1: Write the failing test**

Append to `libs/claw-studio/src/agent/claw-runtime.test.ts`:

```ts
it('resolves a runtime whose graph is a deepagents agent', async () => {
  const runtime = await resolveClawRuntime({ tenantId: TEST_TENANT_ID });
  expect(typeof runtime.graph.stream).toBe('function');
  expect(typeof runtime.graph.invoke).toBe('function');
  expect(runtime.config.configurable).toMatchObject({
    thread_id: expect.any(String),
    tenant_id: TEST_TENANT_ID,
  });
});
```

Reuse whatever tenant constant and setup the existing tests in that file already use — do not invent a new fixture.

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd libs/claw-studio && bunx vitest run src/agent/claw-runtime.test.ts
```

Expected: FAIL — the current graph exposes `updateState`/`getState` but the assertion on a deepagents agent shape will not hold until Step 3.

- [ ] **Step 3: Replace the graph construction**

In `claw-runtime.ts`, change the import:

```ts
// Remove:
// import { createClawGraph } from './claw-graph';
import { createClawDeepAgent } from './claw-deep-agent';
import { ClawWorkspaceBackend } from './workspace-backend';
import { createClawMemoryMiddleware } from '../memory/memory-middleware';
import { createMemoryRecallNode, createMemorySaveNode } from '../memory/memory-nodes';
```

Replace the `createClawGraph({...})` call (lines 206-222) with:

```ts
  const memoryDeps = { reflectorModel: reflectorModel ?? model, tenantId, userId: claw.id, store };
  const graph = createClawDeepAgent({
    model,
    systemPrompt: overrides?.systemPrompt ?? claw.systemPrompt ?? undefined,
    tools,
    tenantId,
    userId: claw.id,
    checkpointer,
    autoApprove: overrides?.autoApprove ?? claw.autoApprove,
    workspaceFiles,
    promptSurface,
    grantedTools: fileTools.grantedWrites,
    approvalPolicy,
    backend: new ClawWorkspaceBackend(workspace, { sourceRunId }),
    middleware: [
      createClawMemoryMiddleware({
        recallNode: createMemoryRecallNode(memoryDeps),
        saveNode: createMemorySaveNode(memoryDeps),
      }),
      // Replaces the hand-rolled getRecentMessages(messages, 25) history trim.
      createSummarizationMiddleware(computeSummarizationDefaults()),
    ],
    modelCallLimit: maxIterations,
  });
```

Add to the deepagents import:

```ts
import { createSummarizationMiddleware, computeSummarizationDefaults } from 'deepagents';
```

`computeSummarizationDefaults` is exported by `deepagents` and derives a sensible
trigger threshold. If it requires arguments, read its signature:

```bash
grep -n "computeSummarizationDefaults" -A 8 node_modules/deepagents/dist/agent-*.d.ts | head -20
```

If the defaults do not fit, pass an explicit options object instead — the shape is
`SummarizationMiddlewareOptions` in the same file. Then delete the now-unused
`getRecentMessages` import from `claw-runtime.ts` if present (it lives in
`agent-shared.ts`; leave the function itself alone, other callers may remain).

`skillContentMap` and `reflectorModel` are no longer passed to the agent — `reflectorModel` now flows only into `memoryDeps`, and skills reach the model through the existing `createLoadSkillTool` already present in the `tools` array.

Update the `ClawRuntime` interface's `graph` type:

```ts
  graph: ReturnType<typeof createClawDeepAgent>;
```

Leave `recursionLimit: recursionLimitFor(maxIterations)` in `config` as-is — deepagents compiles to a LangGraph graph and still honours it.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd libs/claw-studio && bunx vitest run src/agent/claw-runtime.test.ts
```

Expected: PASS. Tests that assert on graph-specific behaviour (`updateState`, node names) will fail — those are superseded; delete them and note it in the commit message.

- [ ] **Step 5: Typecheck and commit**

```bash
cd libs/claw-studio && bunx tsc --noEmit -p tsconfig.lib.json
cd /Users/H2952/Documents/chatflow
git add libs/claw-studio/src/agent/claw-runtime.ts libs/claw-studio/src/agent/claw-runtime.test.ts
git commit -m "feat(claw-studio): build the deepagents agent from resolveClawRuntime"
```

`tsc` will now report errors in `claw-graph.ts` consumers — expected, fixed in Tasks 6-9.

---

### Task 6: Event derivation from the agent stream

`deriveNodeEvents(node, update)` reads graph node names. With no nodes it must derive from the agent's stream chunks instead.

**Files:**
- Modify: `libs/claw-studio/src/gateway/execute-run.ts` (`deriveNodeEvents` at line 110, `SILENT_NODES` at 72)
- Test: `libs/claw-studio/src/gateway/execute-run.test.ts` (existing — extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `deriveNodeEvents(node: string, update: NodeUpdate): NodeEventDraft[]` — **signature unchanged**, so `recordRunEvents` and both mission-control routes keep compiling. `node` becomes a coarse label (`'agent'`) rather than a routing key.

- [ ] **Step 1: Write the failing test**

Append to `libs/claw-studio/src/gateway/execute-run.test.ts`:

```ts
describe('deriveNodeEvents under deepagents', () => {
  it('emits a tool_call for each tool the model requested', () => {
    const drafts = deriveNodeEvents('agent', {
      messages: [{ _getType: () => 'ai', content: '', tool_calls: [{ name: 'jira_create_issue', args: { id: 1 } }] }],
    });
    expect(drafts).toContainEqual({ eventType: 'tool_call', toolName: 'jira_create_issue', toolArgs: { id: 1 } });
  });

  it('emits a tool_result with the output', () => {
    const drafts = deriveNodeEvents('agent', {
      toolResults: [{ toolName: 'jira_create_issue', output: 'DEV-1', isError: false }],
    });
    expect(drafts).toContainEqual({
      eventType: 'tool_result', toolName: 'jira_create_issue', toolOutput: 'DEV-1', metadata: undefined,
    });
  });

  it('emits assistant text as node_complete', () => {
    const drafts = deriveNodeEvents('agent', {
      messages: [{ _getType: () => 'ai', content: 'All done.' }],
    });
    expect(drafts.some((d) => d.eventType === 'node_complete' && d.content === 'All done.')).toBe(true);
  });

  it('stays silent for the write_todos plan tool but still records the call', () => {
    const drafts = deriveNodeEvents('agent', {
      messages: [{ _getType: () => 'ai', content: '', tool_calls: [{ name: 'write_todos', args: { todos: ['a'] } }] }],
    });
    expect(drafts.some((d) => d.eventType === 'tool_call' && d.toolName === 'write_todos')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm the fourth test fails**

```bash
cd libs/claw-studio && bunx vitest run src/gateway/execute-run.test.ts
```

Expected: the first three PASS already (the existing body handles them); the `write_todos` case may pass too. If all four pass, the existing implementation already suffices — record that and skip to Step 4.

- [ ] **Step 3: Narrow `SILENT_NODES`**

`SILENT_NODES` names graph nodes that no longer exist. Replace it:

```ts
// Node names are gone with the graph; the only thing worth suppressing is a
// bare node_complete carrying no text, which the loop emits between tool calls.
const SILENT_NODES = new Set<string>();
```

And guard the trailing `node_complete` so empty turns do not spam the timeline:

```ts
  if (SILENT_NODES.has(node)) return drafts;

  const text = lastMessage && lastMessage._getType?.() === 'ai' ? extractTextContent(lastMessage.content) : '';
  // Under the agent loop, most chunks are tool traffic with no prose. Emitting a
  // contentless node_complete for each one floods the timeline.
  if (!text && drafts.length > 0) return drafts;

  drafts.push({
    eventType: 'node_complete',
    content: text || undefined,
    metadata: update.plan ? { plan: update.plan } : undefined,
  });
  return drafts;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd libs/claw-studio && bunx vitest run src/gateway/execute-run.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/H2952/Documents/chatflow
git add libs/claw-studio/src/gateway/execute-run.ts libs/claw-studio/src/gateway/execute-run.test.ts
git commit -m "feat(claw-studio): derive run events from the agent stream instead of node names"
```

---

### Task 7: Approval flow via `interruptOn`

Replaces `getState().next` interrupt detection and the `updateState(APPROVE_PATCH)` release.

**Files:**
- Modify: `libs/claw-studio/src/gateway/execute-run.ts` (`APPROVE_PATCH` at 62-69, `approvalRequestFrom` at 165-183, the resume branch at 228-244, the interrupt check at 271-291)
- Test: `libs/claw-studio/src/gateway/execute-run.test.ts`

**Interfaces:**
- Consumes: the agent from Task 5.
- Produces: `approvalRequestFrom(interrupts: unknown[], values: NodeUpdate): ApprovalRequest` — takes the agent's interrupt payloads rather than `state.next`. `ApprovalRequest` shape unchanged: `{ kind: 'plan' | 'tool'; planSteps?: string[]; pendingTools?: string[] }`.

- [ ] **Step 1: Write the failing test**

Append to `libs/claw-studio/src/gateway/execute-run.test.ts`:

```ts
describe('approvalRequestFrom under interruptOn', () => {
  it('names the tools from the interrupt payload', () => {
    const request = approvalRequestFrom(
      [{ value: { action_requests: [{ action: 'jira_create_issue', args: { id: 1 } }] } }],
      {},
    );
    expect(request).toEqual({ kind: 'tool', pendingTools: ['jira_create_issue'] });
  });

  it('never returns an empty tool list when an interrupt is present', () => {
    // The bug in libs/claw-studio/CLAUDE.md: interruptBefore paused before the
    // gate ran, so pendingToolApprovals was empty and the prompt named nothing.
    const request = approvalRequestFrom(
      [{ value: { action_requests: [{ action: 'gmail_send_message' }] } }],
      { pendingToolApprovals: [] },
    );
    expect(request.pendingTools).toEqual(['gmail_send_message']);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd libs/claw-studio && bunx vitest run src/gateway/execute-run.test.ts
```

Expected: FAIL — `approvalRequestFrom` is module-private and takes `(next: readonly string[], values)`.

- [ ] **Step 3: Rewrite the approval plumbing**

Export and rewrite `approvalRequestFrom`:

```ts
/** Reads the agent's interrupt payloads and names the tools awaiting approval.
 *  Unlike the old interruptBefore gate, the payload carries the tool name and
 *  args at the moment of the pause, so the list is never empty — this closes
 *  the bug recorded in libs/claw-studio/CLAUDE.md. */
export function approvalRequestFrom(interrupts: unknown[], values: NodeUpdate): ApprovalRequest {
  const names: string[] = [];
  for (const raw of interrupts) {
    const value = (raw as { value?: unknown })?.value as { action_requests?: Array<{ action?: string }> } | undefined;
    for (const req of value?.action_requests ?? []) {
      if (req.action) names.push(req.action);
    }
  }
  if (names.length > 0) return { kind: 'tool', pendingTools: names };
  return { kind: 'plan', planSteps: (values.plan ?? []).map((s) => s.step) };
}
```

Delete `APPROVE_PATCH` (lines 62-69). Replace the resume branch (228-244):

```ts
    let graphInput: { messages: HumanMessage[] } | Command | null = null;
    if (!resume) {
      graphInput = { messages: [new HumanMessage(run.taskDescription)] };
    } else if (resume.action === 'approve' || resume.action === 'approve_always') {
      // interruptOn resumes by feeding a decision back in, not by patching state.
      graphInput = new Command({ resume: [{ type: 'approve' }] });
      await runs.appendEvent(run, {
        eventType: 'approval_decision',
        content: resume.action === 'approve_always' ? 'approved (always, for this task)' : 'approved',
      });
    } else {
      graphInput = { messages: [new HumanMessage(resume.content ?? '')] };
    }
```

Add the import: `import { Command } from '@langchain/langgraph';`

Replace the interrupt check (271-291):

```ts
    const state = await runtime.graph.getState(runtime.config);
    const values = (state.values ?? {}) as NodeUpdate;
    const interrupts = (state.tasks ?? []).flatMap((t: { interrupts?: unknown[] }) => t.interrupts ?? []);

    if (interrupts.length > 0) {
      const request = approvalRequestFrom(interrupts, values);
      await runs.markAwaitingApproval(runId, request);
      await runs.appendEvent(run, {
        eventType: 'approval_request',
        content: request.kind === 'tool'
          ? `Approval needed to run: ${(request.pendingTools ?? []).join(', ')}`
          : 'Approval needed for the plan',
        metadata: { ...request },
      });
      bus.emit({
        name: request.kind === 'tool' ? 'hil:tool_approval' : 'hil:plan_approval',
        runId,
        request,
      });
      return;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd libs/claw-studio && bunx vitest run src/gateway/execute-run.test.ts
```

Expected: PASS.

If the interrupt payload shape differs, log one real interrupt (`console.log(JSON.stringify(interrupts, null, 2))` during a manual run with a mutative tool) and correct the field path in `approvalRequestFrom`. The `action_requests` / `action` names come from `humanInTheLoopMiddleware`'s documented shape.

- [ ] **Step 5: Commit**

```bash
cd /Users/H2952/Documents/chatflow
git add libs/claw-studio/src/gateway/execute-run.ts libs/claw-studio/src/gateway/execute-run.test.ts
git commit -m "feat(claw-studio): resume approvals via interruptOn instead of updateState"
```

---

### Task 8: Update the two mission-control routes

Both inline their own copy of the approval patch and read `values.pendingToolApprovals` directly.

**Files:**
- Modify: `apps/mission-control/app/api/chat/route.ts` (patch at 66-72, stream at 88-95, interrupt check at 199-210)
- Modify: `apps/mission-control/app/api/playground/route.ts` (patch at 100-107, interrupt check at 123-143)

**Interfaces:**
- Consumes: `approvalRequestFrom` — now exported from `execute-run.ts` (Task 7). Add it to the `@chatbot/claw-studio` barrel export if not already present.

- [ ] **Step 1: Export `approvalRequestFrom` from the barrel**

In `libs/claw-studio/src/index.ts`, alongside the existing `deriveNodeEvents` export:

```ts
export { deriveNodeEvents, recordRunEvents, executeRun, terminateRun, approvalRequestFrom } from './gateway/execute-run';
```

- [ ] **Step 2: Replace the approval patch in both routes**

In `chat/route.ts`, replace lines 66-72:

```ts
            await runtime.graph.stream(
              new Command({ resume: [{ type: parsed.data.decision === 'approve' ? 'approve' : 'reject' }] }),
              { ...runtime.config, signal: abortController.signal },
            );
```

Apply the identical change at `playground/route.ts` lines 100-107. Add `import { Command } from '@langchain/langgraph';` to both.

- [ ] **Step 3: Replace the interrupt detection in both routes**

In `chat/route.ts`, replace lines 199-210:

```ts
          if (!handedOff) {
            const state = await runtime.graph.getState(runtime.config);
            const values = (state.values ?? {}) as StateValues;
            const interrupts = (state.tasks ?? []).flatMap((t: { interrupts?: unknown[] }) => t.interrupts ?? []);

            if (interrupts.length > 0) {
              const request = approvalRequestFrom(interrupts, values as never);
              controller.enqueue(encoder.encode(`event: approval\ndata: ${JSON.stringify(request)}\n\n`));
            } else {
```

In `playground/route.ts`, replace lines 123-143:

```ts
          const state = await runtime.graph.getState(runtime.config);
          const values = (state.values ?? {}) as StateValues;
          const interrupts = (state.tasks ?? []).flatMap((t: { interrupts?: unknown[] }) => t.interrupts ?? []);

          if (interrupts.length > 0) {
            const request = approvalRequestFrom(interrupts, values as never);
            await runs.markAwaitingApproval(run.runId, request);
            await runs.appendEvent(run, {
              eventType: 'approval_request',
              content: request.kind === 'tool'
                ? `Approval needed to run: ${(request.pendingTools ?? []).join(', ')}`
                : 'Approval needed for the plan',
              metadata: { ...request },
            });
            send(controller, 'approval', request);
          } else {
```

Both routes now use the shared helper, so they gain the empty-tool-list fix rather than keeping their own buggy copies.

- [ ] **Step 4: Keep `streamMode` and verify token streaming**

Leave `streamMode: ['updates', 'custom']` in `chat/route.ts` and the manual async-iterator loop **unchanged** — the comment at line 102 explains that `for await`'s `break` triggers IteratorClose and would abort the run before memory save.

`custom` mode carried token deltas the old graph pushed via `getWriter()`. deepagents does not call `getWriter()`. Run a real chat turn and confirm whether `token` SSE events still arrive:

```bash
cd /Users/H2952/Documents/chatflow && bun run dev
```

If no `token` events arrive, add `'messages'` to `streamMode` and map its chunks to `token` events. Note the existing warning: `'messages'` taps every node's model call and previously duplicated the reply — with a single agent loop that concern is reduced, but verify against a real provider before relying on it.

- [ ] **Step 5: Typecheck and commit**

```bash
cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json
cd /Users/H2952/Documents/chatflow
git add libs/claw-studio/src/index.ts apps/mission-control/app/api/chat/route.ts apps/mission-control/app/api/playground/route.ts
git commit -m "feat(mission-control): drive approvals through the shared interruptOn helper"
```

---

### Task 9: Delete the graph

**Files:**
- Delete: `libs/claw-studio/src/agent/claw-graph.ts`, `libs/claw-studio/src/agent/claw-graph.test.ts`
- Delete: `libs/claw-studio/src/agent/executor-state.ts` (and its test if present)
- Delete: `libs/claw-studio/src/agent/claw-agent.ts`, `libs/claw-studio/src/agent/claw-agent.test.ts`
- Modify: `libs/claw-studio/src/index.ts`

- [ ] **Step 1: Audit which state channels still matter**

Before deleting `executor-state.ts`, list its channels and check each against the new agent:

```bash
cd /Users/H2952/Documents/chatflow
grep -n "Annotation" libs/claw-studio/src/agent/executor-state.ts
grep -rn "memoryContext\|memoryStats\|toolResults\|plan\b" libs/claw-studio/src/gateway libs/claw-studio/src/memory --include="*.ts" | grep -v "\.test\." | head -20
```

Channels consumed only by deleted nodes go away. Any still read by `deriveNodeEvents` (`plan`, `toolResults`, `messages`) or the memory middleware (`memoryContext`) must be declared as a `stateSchema` on `createDeepAgent` in `claw-deep-agent.ts`. Add them there before deleting.

- [ ] **Step 2: Delete the files**

```bash
cd /Users/H2952/Documents/chatflow
git rm libs/claw-studio/src/agent/claw-graph.ts libs/claw-studio/src/agent/claw-graph.test.ts
git rm libs/claw-studio/src/agent/executor-state.ts
git rm libs/claw-studio/src/agent/claw-agent.ts libs/claw-studio/src/agent/claw-agent.test.ts
```

- [ ] **Step 3: Clean the barrel**

Remove every `claw-graph` / `executor-state` / `claw-agent` re-export from `libs/claw-studio/src/index.ts`. Find them:

```bash
grep -n "claw-graph\|executor-state\|claw-agent" libs/claw-studio/src/index.ts
```

- [ ] **Step 4: Typecheck and run the full suite**

```bash
cd libs/claw-studio && bunx tsc --noEmit -p tsconfig.lib.json && bunx vitest run
cd /Users/H2952/Documents/chatflow && bunx tsc --noEmit -p apps/mission-control/tsconfig.json
```

Expected: no unresolved imports, full suite green. Any test that asserted on node names or `updateState` is superseded — delete it and say so in the commit message.

- [ ] **Step 5: Commit**

```bash
cd /Users/H2952/Documents/chatflow
git add -A libs/claw-studio apps/mission-control
git commit -m "refactor(claw-studio): delete the hand-written graph, executor state, and the createAgent spike"
```

---

### Task 10: End-to-end verification

- [ ] **Step 1: Run the full library suite**

```bash
cd libs/claw-studio && bunx vitest run
```

Expected: green. `tool-classifier.test.ts`, `prompt-composer.test.ts` and `prompt-templates.test.ts` must all still pass untouched — they pin the non-regression guarantees.

- [ ] **Step 2: Drive a real turn**

```bash
cd /Users/H2952/Documents/chatflow && bun run dev
```

In mission-control, send a simple message. Confirm: a reply arrives; `[claw-deep-agent] building agent` appears in the logs; and `[MemorySave]` appears after the turn.

- [ ] **Step 3: Drive a task that needs a mutative tool**

Ask for something that triggers a gated tool. Confirm the approval prompt **names the tool** — this is the CLAUDE.md bug fix. Approve, and confirm the run resumes.

- [ ] **Step 4: Confirm memory still writes**

State a durable preference (e.g. "Always give me command output as JSON, never a table"), let the turn finish, then check:

```sql
SELECT "kind", "namespace", "key" FROM claw_memories ORDER BY "createdAt" DESC LIMIT 5;
```

Expected: a new row. If none, check the logs for `[MemorySave] nothing to save` (correct — content was ephemeral) versus `Failed to resolve Claw embeddings` (a provider problem, unrelated to this migration).

- [ ] **Step 5: Update the library CLAUDE.md**

`libs/claw-studio/CLAUDE.md` documents the graph, its nodes, `interruptBefore`, and the approval bug. Rewrite those sections for the agent loop, and **delete the "not yet fixed" note about `interruptBefore` and empty `pendingToolApprovals`** — Task 7 fixes it.

```bash
cd /Users/H2952/Documents/chatflow
git add libs/claw-studio/CLAUDE.md
git commit -m "docs(claw-studio): describe the deepagents loop and close the approval-gate bug note"
```

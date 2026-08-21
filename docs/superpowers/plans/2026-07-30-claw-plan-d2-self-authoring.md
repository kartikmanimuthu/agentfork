# Claw Self-Authoring Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claw read and rewrite its own workspace files, so it accumulates a model of the user over time — gated so that rewriting its persona needs approval while learning your preferences does not.

**Architecture:** Four LangChain tools (`list_workspace_files`, `read_workspace_file`, `write_workspace_file`, `edit_workspace_file`) built on Task D1's `WorkspaceFileService`. Writes are governed by a per-slug policy: `user`/`tools`/`heartbeat` are pre-granted so they pass the existing `mutative_approval_gate` un-prompted, while `soul`/`agents`/`identity` prompt for approval. A per-run write counter and a `CLAW_SELF_AUTHORING` env kill-switch bound the blast radius. Approval gating itself is free — `write_*`/`edit_*` already match `/\bwrite\b/i` in `tool-classifier.ts`.

**Tech Stack:** TypeScript strict, LangChain `tool()` + Zod schemas, Prisma, Vitest, T3 Env, Pino.

**Spec:** `docs/superpowers/specs/2026-07-30-claw-soul-and-cron-design.md` (§5, §7.4)

**Depends on:** `2026-07-30-claw-plan-d1-workspace-files.md` must be complete. This plan consumes `WorkspaceFileService`, `WorkspaceSlug`, `SLUG_CHAR_CAPS`, and `WorkspaceFileTooLargeError` from it.

## Global Constraints

- **Non-regression (spec §7.4).** Baseline before D1 was `Test Files 48 passed (48)`, `Tests 443 passed (443)`. D1 added to that. This plan must keep every existing test green and only add.
- **Do NOT modify:** `libs/claw-studio/src/integrations/**`, `connectors/**`, `gateway/**`, `memory/**`, `skills/**`, `mcp/**`. In particular **do not modify `agent/tool-classifier.ts`** — the gating this plan needs already works via its existing `/\bwrite\b/i` pattern. Adding entries there would risk reclassifying unrelated tools.
- **Only pre-existing files this plan touches:** `libs/claw-studio/src/agent/claw-graph.ts` (grant plumbing only), `libs/claw-studio/src/agent/claw-runtime.ts` (splice tools), `libs/claw-studio/src/env.ts`, `libs/claw-studio/src/index.ts`, `libs/claw-studio/CLAUDE.md`.
- **`CLAW_SELF_AUTHORING`** is `'off' | 'user' | 'all'`, default `'user'`. `off` = Claw cannot write any file. `user` = Claw may write `user`/`tools`/`heartbeat` only. `all` = Claw may also write `soul`/`agents`/`identity`, still approval-gated.
- **Per-run write cap:** 5 writes per graph run, then further writes return an error string (never throw — a thrown tool error aborts the run).
- **Tools must never throw.** A LangChain tool that throws kills the run. Every failure path returns a human-readable string the model can recover from. This matches how every existing integration tool in this repo behaves (see `integrations/gmail.ts`).
- **Standards:** Zod schemas on every tool; env via T3 Env only; try/catch everywhere with Pino structured context `{ tenantId, clawId, slug }`.
- **Tests:** `cd libs/claw-studio && bunx vitest run` — must be run with that cwd.
- **Code style:** no comments unless the *why* is non-obvious; no multi-line docstrings.
- **UI conventions:** Task 5 touches Mission Control components. Follow the *Mission Control UI Conventions* section in `2026-07-30-claw-plan-d1-workspace-files.md` exactly — in particular `toast.success("Title", { description })` two-arg form and `DropdownMenuTrigger render={<Button/>}` rather than `asChild`.

---

### Task 1: Self-authoring policy module

**Files:**
- Create: `libs/claw-studio/src/workspace/self-authoring-policy.ts`
- Test: `libs/claw-studio/src/workspace/self-authoring-policy.test.ts`
- Modify: `libs/claw-studio/src/env.ts`

**Interfaces:**
- Consumes: `WorkspaceSlug`, `WORKSPACE_SLUGS` from D1 Task 2
- Produces:
  - `type SelfAuthoringMode = 'off' | 'user' | 'all'`
  - `const FREE_WRITE_SLUGS: readonly WorkspaceSlug[]` = `['user', 'tools', 'heartbeat']`
  - `const GATED_WRITE_SLUGS: readonly WorkspaceSlug[]` = `['identity', 'soul', 'agents']`
  - `function selfAuthoringMode(): SelfAuthoringMode` (reads T3 env)
  - `function canClawWrite(slug: WorkspaceSlug, mode: SelfAuthoringMode): boolean`
  - `function isFreeWrite(slug: WorkspaceSlug): boolean`
  - `const MAX_WRITES_PER_RUN = 5`

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/workspace/self-authoring-policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  FREE_WRITE_SLUGS, GATED_WRITE_SLUGS, MAX_WRITES_PER_RUN, canClawWrite, isFreeWrite,
} from './self-authoring-policy';
import { WORKSPACE_SLUGS } from './types';

describe('self-authoring policy', () => {
  it('partitions every slug into exactly one of free or gated', () => {
    const all = [...FREE_WRITE_SLUGS, ...GATED_WRITE_SLUGS].sort();
    expect(all).toEqual([...WORKSPACE_SLUGS].sort());
    expect(new Set(all).size).toBe(WORKSPACE_SLUGS.length);
  });

  it('treats user, tools and heartbeat as free writes', () => {
    expect(isFreeWrite('user')).toBe(true);
    expect(isFreeWrite('tools')).toBe(true);
    expect(isFreeWrite('heartbeat')).toBe(true);
  });

  it('treats identity, soul and agents as gated writes', () => {
    expect(isFreeWrite('soul')).toBe(false);
    expect(isFreeWrite('agents')).toBe(false);
    expect(isFreeWrite('identity')).toBe(false);
  });

  it('blocks every write when mode is off', () => {
    for (const slug of WORKSPACE_SLUGS) {
      expect(canClawWrite(slug, 'off')).toBe(false);
    }
  });

  it('allows only free slugs when mode is user', () => {
    expect(canClawWrite('user', 'user')).toBe(true);
    expect(canClawWrite('heartbeat', 'user')).toBe(true);
    expect(canClawWrite('soul', 'user')).toBe(false);
    expect(canClawWrite('agents', 'user')).toBe(false);
  });

  it('allows every slug when mode is all', () => {
    for (const slug of WORKSPACE_SLUGS) {
      expect(canClawWrite(slug, 'all')).toBe(true);
    }
  });

  it('caps writes per run', () => {
    expect(MAX_WRITES_PER_RUN).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/workspace/self-authoring-policy.test.ts`
Expected: FAIL — cannot resolve `./self-authoring-policy`.

- [ ] **Step 3: Write the implementation**

First add to `libs/claw-studio/src/env.ts`, inside `server`:

```ts
    CLAW_SELF_AUTHORING: z.enum(['off', 'user', 'all']).default('user'),
```

Then create `libs/claw-studio/src/workspace/self-authoring-policy.ts`:

```ts
import { env } from '../env';
import type { WorkspaceSlug } from './types';

export type SelfAuthoringMode = 'off' | 'user' | 'all';

// Claw learning your preferences must not nag, so these pass the approval gate
// un-prompted. Rewriting its own persona is rare and high-consequence, so those
// prompt.
export const FREE_WRITE_SLUGS: readonly WorkspaceSlug[] = ['user', 'tools', 'heartbeat'] as const;
export const GATED_WRITE_SLUGS: readonly WorkspaceSlug[] = ['identity', 'soul', 'agents'] as const;

export const MAX_WRITES_PER_RUN = 5;

export function selfAuthoringMode(): SelfAuthoringMode {
  return env.CLAW_SELF_AUTHORING;
}

export function isFreeWrite(slug: WorkspaceSlug): boolean {
  return (FREE_WRITE_SLUGS as readonly string[]).includes(slug);
}

export function canClawWrite(slug: WorkspaceSlug, mode: SelfAuthoringMode): boolean {
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return isFreeWrite(slug);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/claw-studio && bunx vitest run src/workspace/self-authoring-policy.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/workspace/self-authoring-policy.ts libs/claw-studio/src/workspace/self-authoring-policy.test.ts libs/claw-studio/src/env.ts
git commit -m "feat(claw-studio): add self-authoring policy and CLAW_SELF_AUTHORING env"
```

---

### Task 2: The four workspace file tools

**Files:**
- Create: `libs/claw-studio/src/agent/file-tools.ts`
- Test: `libs/claw-studio/src/agent/file-tools.test.ts`

**Interfaces:**
- Consumes: `WorkspaceFileService`, `WorkspaceFileTooLargeError`, `WorkspaceSlug`, `WORKSPACE_SLUGS`, `SLUG_CHAR_CAPS`, `isWorkspaceSlug` (D1); policy helpers (Task 1)
- Produces:
  ```ts
  interface FileToolsHandle {
    tools: StructuredTool[];
    /** Slugs written during this run — read by the graph to pre-grant approval. */
    grantedWrites: Set<string>;
  }
  function createFileTools(tenantId: string, clawId: string, opts?: {
    service?: WorkspaceFileService;
    sourceRunId?: string;
    mode?: SelfAuthoringMode;
  }): FileToolsHandle;
  ```

Tool names, fixed (the graph and the UI both reference these strings):
`list_workspace_files`, `read_workspace_file`, `write_workspace_file`, `edit_workspace_file`.

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/agent/file-tools.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileTools } from './file-tools';
import { WorkspaceFileTooLargeError } from '../workspace/workspace-file-service';

function fakeService(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    list: vi.fn(async () =>
      [...store.entries()].map(([slug, content]) => ({
        slug, content, version: 1, updatedBy: 'user', updatedAt: new Date('2026-07-30'),
      })),
    ),
    read: vi.fn(async (slug: string) =>
      store.has(slug)
        ? { slug, content: store.get(slug)!, version: 1, updatedBy: 'user', updatedAt: new Date() }
        : null,
    ),
    write: vi.fn(async (slug: string, content: string) => {
      if (content.length > 4000 && slug === 'soul') throw new WorkspaceFileTooLargeError('soul' as never, content.length);
      store.set(slug, content);
      return { slug, content, version: 2, updatedBy: 'claw', updatedAt: new Date() };
    }),
  };
}

const byName = (tools: ReturnType<typeof createFileTools>['tools'], name: string) => {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
};

describe('createFileTools', () => {
  let svc: ReturnType<typeof fakeService>;

  beforeEach(() => { svc = fakeService({ soul: 'Terse.', user: 'Name: Omar' }); });

  it('exposes exactly the four expected tools', () => {
    const { tools } = createFileTools('t1', 'c1', { service: svc as never });
    expect(tools.map((t) => t.name).sort()).toEqual([
      'edit_workspace_file', 'list_workspace_file'.replace('file', 'files'), 'read_workspace_file', 'write_workspace_file',
    ].sort());
  });

  it('lists files with metadata but not full content', async () => {
    const { tools } = createFileTools('t1', 'c1', { service: svc as never });
    const out = await byName(tools, 'list_workspace_files').invoke({});
    expect(out).toContain('soul');
    expect(out).toContain('user');
  });

  it('reads a file', async () => {
    const { tools } = createFileTools('t1', 'c1', { service: svc as never });
    const out = await byName(tools, 'read_workspace_file').invoke({ slug: 'soul' });
    expect(out).toContain('Terse.');
  });

  it('returns a helpful string for an unknown slug rather than throwing', async () => {
    const { tools } = createFileTools('t1', 'c1', { service: svc as never });
    const out = await byName(tools, 'read_workspace_file').invoke({ slug: 'memory' });
    expect(out).toMatch(/unknown|not a workspace file/i);
  });

  it('writes a free slug and records the grant', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'user' });
    const out = await byName(handle.tools, 'write_workspace_file')
      .invoke({ slug: 'user', content: 'Name: Omar. Prefers terse replies.', reason: 'learned preference' });
    expect(out).toMatch(/saved|updated/i);
    expect(handle.grantedWrites.has('write_workspace_file')).toBe(true);
    expect(svc.write).toHaveBeenCalledWith('user', 'Name: Omar. Prefers terse replies.', expect.objectContaining({ updatedBy: 'claw', reason: 'learned preference' }));
  });

  it('refuses a gated slug when mode is user, without throwing', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'user' });
    const out = await byName(handle.tools, 'write_workspace_file')
      .invoke({ slug: 'soul', content: 'New persona.', reason: 'felt like it' });
    expect(out).toMatch(/not permitted|cannot/i);
    expect(svc.write).not.toHaveBeenCalled();
    expect(handle.grantedWrites.size).toBe(0);
  });

  it('allows a gated slug when mode is all, and does NOT pre-grant it', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    const out = await byName(handle.tools, 'write_workspace_file')
      .invoke({ slug: 'soul', content: 'New persona.', reason: 'user asked' });
    expect(out).toMatch(/saved|updated/i);
    expect(handle.grantedWrites.size).toBe(0);
  });

  it('refuses every write when mode is off', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'off' });
    const out = await byName(handle.tools, 'write_workspace_file')
      .invoke({ slug: 'user', content: 'x', reason: 'y' });
    expect(out).toMatch(/disabled|not permitted/i);
    expect(svc.write).not.toHaveBeenCalled();
  });

  it('edits surgically', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    await byName(handle.tools, 'edit_workspace_file')
      .invoke({ slug: 'user', oldText: 'Name: Omar', newText: 'Name: Omar (prefers terse)', reason: 'refine' });
    expect(svc.store.get('user')).toBe('Name: Omar (prefers terse)');
  });

  it('reports missing oldText instead of guessing', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    const out = await byName(handle.tools, 'edit_workspace_file')
      .invoke({ slug: 'user', oldText: 'nope', newText: 'x', reason: 'r' });
    expect(out).toMatch(/not found/i);
    expect(svc.write).not.toHaveBeenCalled();
  });

  it('reports ambiguous oldText instead of editing the wrong one', async () => {
    svc = fakeService({ user: 'foo\nfoo' });
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    const out = await byName(handle.tools, 'edit_workspace_file')
      .invoke({ slug: 'user', oldText: 'foo', newText: 'bar', reason: 'r' });
    expect(out).toMatch(/appears 2 times|ambiguous/i);
    expect(svc.write).not.toHaveBeenCalled();
  });

  it('enforces the per-run write cap', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    const write = byName(handle.tools, 'write_workspace_file');
    for (let i = 0; i < 5; i++) {
      await write.invoke({ slug: 'user', content: `v${i}`, reason: 'r' });
    }
    const out = await write.invoke({ slug: 'user', content: 'v6', reason: 'r' });
    expect(out).toMatch(/limit|too many/i);
    expect(svc.write).toHaveBeenCalledTimes(5);
  });

  it('surfaces an over-cap write as a message, not a thrown error', async () => {
    const handle = createFileTools('t1', 'c1', { service: svc as never, mode: 'all' });
    const out = await byName(handle.tools, 'write_workspace_file')
      .invoke({ slug: 'soul', content: 'x'.repeat(5000), reason: 'r' });
    expect(out).toMatch(/limit|too large|over the/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/file-tools.test.ts`
Expected: FAIL — cannot resolve `./file-tools`.

- [ ] **Step 3: Write the implementation**

Create `libs/claw-studio/src/agent/file-tools.ts`:

```ts
import { tool, type StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import {
  WorkspaceFileService, WorkspaceFileTooLargeError,
} from '../workspace/workspace-file-service';
import { SLUG_CHAR_CAPS, WORKSPACE_SLUGS, isWorkspaceSlug, type WorkspaceSlug } from '../workspace/types';
import {
  MAX_WRITES_PER_RUN, canClawWrite, isFreeWrite, selfAuthoringMode,
  type SelfAuthoringMode,
} from '../workspace/self-authoring-policy';

const logger = createLogger('claw-studio:file-tools');

const SLUG_LIST = WORKSPACE_SLUGS.join(', ');

export interface FileToolsHandle {
  tools: StructuredTool[];
  /** Tool names pre-granted for this run, so free-slug writes skip the approval gate. */
  grantedWrites: Set<string>;
}

export interface FileToolsOptions {
  service?: WorkspaceFileService;
  sourceRunId?: string;
  mode?: SelfAuthoringMode;
}

export function createFileTools(
  tenantId: string,
  clawId: string,
  opts: FileToolsOptions = {},
): FileToolsHandle {
  const svc = opts.service ?? new WorkspaceFileService(tenantId, clawId);
  const mode = opts.mode ?? selfAuthoringMode();
  const grantedWrites = new Set<string>();
  let writes = 0;

  const ctx = { tenantId, clawId };

  function rejectSlug(slug: string): string {
    return `"${slug}" is not a workspace file. Valid files: ${SLUG_LIST}.`;
  }

  function checkWritable(slug: WorkspaceSlug): string | null {
    if (mode === 'off') {
      return 'Editing workspace files is disabled for this agent.';
    }
    if (!canClawWrite(slug, mode)) {
      return `You are not permitted to edit "${slug}". Ask the user to change it in Mission Control → Agent.`;
    }
    if (writes >= MAX_WRITES_PER_RUN) {
      return `Write limit reached (${MAX_WRITES_PER_RUN} per run). Make no further file edits this turn.`;
    }
    return null;
  }

  async function persist(
    slug: WorkspaceSlug,
    content: string,
    reason: string,
  ): Promise<string> {
    try {
      const saved = await svc.write(slug, content, {
        updatedBy: 'claw',
        reason,
        sourceRunId: opts.sourceRunId,
      });
      writes += 1;
      if (isFreeWrite(slug)) grantedWrites.add('write_workspace_file');
      logger.info({ ...ctx, slug, version: saved.version }, 'Claw wrote a workspace file');
      return `Saved ${slug} (now v${saved.version}).`;
    } catch (error) {
      if (error instanceof WorkspaceFileTooLargeError) {
        return `Cannot save: ${error.message}. Shorten it and try again.`;
      }
      logger.error({ error, ...ctx, slug }, 'Claw workspace write failed');
      return `Could not save ${slug}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const list_workspace_files = tool(
    async () => {
      try {
        const files = await svc.list();
        if (!files.length) return 'No workspace files exist yet.';
        return files
          .map((f) => `${f.slug}: ${f.content.length}/${SLUG_CHAR_CAPS[f.slug]} chars, v${f.version}, last edited by ${f.updatedBy}`)
          .join('\n');
      } catch (error) {
        logger.error({ error, ...ctx }, 'list_workspace_files failed');
        return `Could not list workspace files: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'list_workspace_files',
      description: `List your workspace files (${SLUG_LIST}) with their sizes and versions. These files define who you are and what you know about the user.`,
      schema: z.object({}),
    },
  );

  const read_workspace_file = tool(
    async ({ slug }: { slug: string }) => {
      try {
        if (!isWorkspaceSlug(slug)) return rejectSlug(slug);
        const file = await svc.read(slug);
        if (!file) return `"${slug}" is empty.`;
        return file.content;
      } catch (error) {
        logger.error({ error, ...ctx, slug }, 'read_workspace_file failed');
        return `Could not read ${slug}: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'read_workspace_file',
      description: `Read one of your workspace files. Valid slugs: ${SLUG_LIST}. Read before editing so you preserve what is already there.`,
      schema: z.object({ slug: z.string().describe(`One of: ${SLUG_LIST}`) }),
    },
  );

  const write_workspace_file = tool(
    async ({ slug, content, reason }: { slug: string; content: string; reason: string }) => {
      if (!isWorkspaceSlug(slug)) return rejectSlug(slug);
      const blocked = checkWritable(slug);
      if (blocked) return blocked;
      return persist(slug, content, reason);
    },
    {
      name: 'write_workspace_file',
      description: `Replace a workspace file's entire contents. Use for "user" to record durable facts and preferences about the person you're helping, and "heartbeat" for standing checks on scheduled runs. Prefer edit_workspace_file for small changes. Do not rewrite "soul" or "agents" unless the user explicitly asks.`,
      schema: z.object({
        slug: z.string().describe(`One of: ${SLUG_LIST}`),
        content: z.string().describe('The complete new contents'),
        reason: z.string().describe('Why you are making this change — stored in the revision history'),
      }),
    },
  );

  const edit_workspace_file = tool(
    async ({ slug, oldText, newText, reason }: { slug: string; oldText: string; newText: string; reason: string }) => {
      if (!isWorkspaceSlug(slug)) return rejectSlug(slug);
      const blocked = checkWritable(slug);
      if (blocked) return blocked;
      try {
        const file = await svc.read(slug);
        const current = file?.content ?? '';
        const occurrences = current.split(oldText).length - 1;
        if (occurrences === 0) {
          return `oldText not found in ${slug}. Read the file first, then pass text that appears in it exactly.`;
        }
        if (occurrences > 1) {
          return `oldText appears ${occurrences} times in ${slug} — ambiguous. Include more surrounding text so it matches exactly once.`;
        }
        return persist(slug, current.replace(oldText, newText), reason);
      } catch (error) {
        logger.error({ error, ...ctx, slug }, 'edit_workspace_file failed');
        return `Could not edit ${slug}: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'edit_workspace_file',
      description: `Replace one exact snippet in a workspace file, leaving the rest untouched. oldText must appear exactly once. Prefer this over write_workspace_file so you don't discard content you didn't intend to change.`,
      schema: z.object({
        slug: z.string().describe(`One of: ${SLUG_LIST}`),
        oldText: z.string().describe('Exact text to replace; must occur exactly once'),
        newText: z.string().describe('Replacement text'),
        reason: z.string().describe('Why you are making this change — stored in the revision history'),
      }),
    },
  );

  return {
    tools: [list_workspace_files, read_workspace_file, write_workspace_file, edit_workspace_file],
    grantedWrites,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/claw-studio && bunx vitest run src/agent/file-tools.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/agent/file-tools.ts libs/claw-studio/src/agent/file-tools.test.ts
git commit -m "feat(claw-studio): add workspace file self-authoring tools"
```

---

### Task 3: Runtime-granted tools in the graph

**Files:**
- Modify: `libs/claw-studio/src/agent/claw-graph.ts` (deps interface; `routeFromGenerateToTools` ~line 371; `routeFromRevise` ~line 581; `mutativeApprovalGateNode` ~line 428)
- Test: `libs/claw-studio/src/agent/claw-graph.test.ts` (extend)

**Interfaces:**
- Consumes: `grantedWrites` from Task 2
- Produces: `ClawGraphDeps` gains `grantedTools?: Set<string>`. Both route functions and the gate node exclude granted tool names from the mutative set.

**Why a `Set` reference rather than a list:** `createFileTools` populates `grantedWrites` lazily — a `user` write only becomes granted after it happens. Passing the live `Set` means the graph sees the grant without rebuilding.

**Note:** the same two route functions are modified again in plan D3 to add `approvalPolicy`. Doing grants here first keeps each change independently reviewable; D3 layers on top.

- [ ] **Step 1: Write the failing test**

Append to `libs/claw-studio/src/agent/claw-graph.test.ts`:

```ts
describe('grantedTools bypass the mutative approval gate', () => {
  it('routes a granted mutative tool straight to tools', async () => {
    const model = makeToolCallingModel([{ name: 'write_workspace_file', args: { slug: 'user' } }]);
    const graph = createClawGraph({
      model,
      tenantId: 't1',
      userId: 'c1',
      autoApprove: false,
      checkpointer: makeCheckpointer(),
      grantedTools: new Set(['write_workspace_file']),
    });

    const state = await graph.invoke(
      { messages: [new HumanMessage('remember I prefer terse replies')] },
      { configurable: { thread_id: 'grant-1' } },
    );
    expect(state.pendingToolApprovals ?? []).toHaveLength(0);
  });

  it('still gates an ungranted mutative tool', async () => {
    const model = makeToolCallingModel([{ name: 'gmail_send_message', args: { to: 'a@b.c' } }]);
    const graph = createClawGraph({
      model,
      tenantId: 't1',
      userId: 'c1',
      autoApprove: false,
      checkpointer: makeCheckpointer(),
      grantedTools: new Set(['write_workspace_file']),
    });

    await graph.invoke(
      { messages: [new HumanMessage('email them')] },
      { configurable: { thread_id: 'grant-2' } },
    );
    const snapshot = await graph.getState({ configurable: { thread_id: 'grant-2' } });
    expect(snapshot.next).toContain('mutative_approval_gate');
  });
});
```

Reuse the file's existing helpers for stub models and checkpointers. If they are named differently, use the existing names rather than introducing `makeToolCallingModel` / `makeCheckpointer`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/claw-graph.test.ts`
Expected: FAIL — `grantedTools` unknown; the granted write is still gated.

- [ ] **Step 3: Write the implementation**

In `libs/claw-studio/src/agent/claw-graph.ts`:

(a) Add to `ClawGraphDeps`:

```ts
  /** Tool names exempt from the mutative approval gate for this run. Live reference:
   *  file-tools populates it as free-slug writes happen. */
  grantedTools?: Set<string>;
```

(b) Add `grantedTools` to the `createClawGraph` destructure, then just below it:

```ts
  const granted = grantedTools ?? new Set<string>();
```

(c) In `routeFromGenerateToTools`, change the mutative filter line from:

```ts
    const mutative = filterMutativeToolCalls(toolCalls);
```

to:

```ts
    const mutative = filterMutativeToolCalls(toolCalls).filter((tc) => !granted.has(tc.name));
```

(d) Apply the identical change in `routeFromRevise`.

(e) In `mutativeApprovalGateNode`, apply the same `.filter((tc) => !granted.has(tc.name))` to its `filterMutativeToolCalls(toolCalls)` call so the recorded `pendingToolApprovals` list matches what the router decided. A mismatch here would show the user an approval request for a tool that was already allowed to run.

- [ ] **Step 4: Run the full suite**

Run: `cd libs/claw-studio && bunx vitest run`
Expected: PASS, including the two new tests and all pre-existing gate tests.

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/agent/claw-graph.ts libs/claw-studio/src/agent/claw-graph.test.ts
git commit -m "feat(claw-studio): let granted tools bypass the mutative approval gate"
```

---

### Task 4: Splice file tools into the runtime

**Files:**
- Modify: `libs/claw-studio/src/agent/claw-runtime.ts` (tool array ~line 142; `createClawGraph` call ~line 155)
- Modify: `libs/claw-studio/src/index.ts`
- Test: `libs/claw-studio/src/agent/claw-runtime.test.ts` (extend)

**Interfaces:**
- Consumes: `createFileTools` (Task 2), `grantedTools` dep (Task 3)
- Produces: `ResolveClawRuntimeInput` gains `sourceRunId?: string`. The runtime binds the four file tools and threads `grantedWrites` through as `grantedTools`.

- [ ] **Step 1: Write the failing test**

Append to `libs/claw-studio/src/agent/claw-runtime.test.ts`:

```ts
describe('file tools binding', () => {
  it('binds the four workspace file tools', async () => {
    await resolveClawRuntime({ tenantId: 't1' });
    const names = (createClawGraphSpy.mock.calls.at(-1)![0].tools as Array<{ name: string }>)
      .map((t) => t.name);
    expect(names).toContain('list_workspace_files');
    expect(names).toContain('read_workspace_file');
    expect(names).toContain('write_workspace_file');
    expect(names).toContain('edit_workspace_file');
  });

  it('passes a grantedTools set to the graph', async () => {
    await resolveClawRuntime({ tenantId: 't1' });
    expect(createClawGraphSpy.mock.calls.at(-1)![0].grantedTools).toBeInstanceOf(Set);
  });
});
```

Use whatever the existing spy on `createClawGraph` is called in that file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/claw-runtime.test.ts`
Expected: FAIL — file tools absent, `grantedTools` undefined.

- [ ] **Step 3: Write the implementation**

In `libs/claw-studio/src/agent/claw-runtime.ts`:

(a) Add the import:

```ts
import { createFileTools } from './file-tools';
```

(b) Add to `ResolveClawRuntimeInput`:

```ts
  /** Stamped onto workspace-file revisions Claw writes during this run. */
  sourceRunId?: string;
```

(c) Destructure `sourceRunId` alongside the rest.

(d) Replace the tool-array construction. The `WorkspaceFileService` instance created in D1 Task 7 is reused here rather than constructing a second one:

```ts
    const fileTools = createFileTools(tenantId, claw.id, {
      service: workspace,
      sourceRunId,
    });
    const tools = [
      ...createMemoryTools(tenantId, claw.id),
      createLoadSkillTool(tenantId),
      ...fileTools.tools,
      ...mcpTools,
      ...integrationTools,
    ];
```

(e) Add to the `createClawGraph` call:

```ts
      grantedTools: fileTools.grantedWrites,
```

(f) In `libs/claw-studio/src/index.ts`, add:

```ts
export { createFileTools } from './agent/file-tools';
export type { FileToolsHandle, FileToolsOptions } from './agent/file-tools';

export {
  FREE_WRITE_SLUGS, GATED_WRITE_SLUGS, MAX_WRITES_PER_RUN,
  canClawWrite, isFreeWrite, selfAuthoringMode,
} from './workspace/self-authoring-policy';
export type { SelfAuthoringMode } from './workspace/self-authoring-policy';
```

- [ ] **Step 4: Run the full suite and typecheck**

Run:
```bash
cd libs/claw-studio && bunx vitest run && bunx tsc --noEmit -p tsconfig.json
```
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/agent/claw-runtime.ts libs/claw-studio/src/agent/claw-runtime.test.ts libs/claw-studio/src/index.ts
git commit -m "feat(claw-studio): bind workspace file tools in the runtime"
```

---

### Task 5: Surface Claw's own edits in the UI

**Files:**
- Modify: `apps/mission-control/components/agent/revision-history-dialog.tsx` (from D1 Task 9)
- Modify: `apps/mission-control/components/agent/file-editor.tsx` (from D1 Task 9)

**Interfaces:**
- Consumes: the `revisions` API from D1 Task 8, which already returns `updatedBy`
- Produces: visible distinction between a human edit and a Claw self-edit

Without this, a user cannot tell that Claw rewrote its own `user` file — which is the whole point of the feature and also the main thing they'd want to audit.

- [ ] **Step 1: Add a Claw badge to the history rows**

In `revision-history-dialog.tsx`, add the `Badge` import:

```tsx
import { Badge } from '@/components/ui/badge';
```

and replace the `updatedBy` cell:

```tsx
                  <TableCell>
                    {r.updatedBy === 'claw'
                      ? <Badge variant="secondary">Claw</Badge>
                      : <span className="text-muted-foreground">You</span>}
                  </TableCell>
```

- [ ] **Step 2: Show it on the editor footer too**

In `file-editor.tsx`, replace the `last edited by {file.updatedBy}` fragment with:

```tsx
          {' · '}last edited by {file.updatedBy === 'claw' ? 'Claw' : 'you'}
```

- [ ] **Step 3: Verify end to end in the running app**

1. Ensure `CLAW_SELF_AUTHORING` is unset or `user`.
2. Open `/chat` and say: *"Remember that I prefer terse answers and I work on the Claw Studio project."*
3. Claw should call `write_workspace_file` on `user` **without prompting for approval** (free slug).
4. Open `/agent` → `User` tab: the content reflects what you said, footer reads `last edited by Claw`.
5. Click `History`: the top row shows the `Claw` badge and the reason Claw gave.
6. Now say: *"Change your personality to be very formal."* Claw should either refuse
   (`CLAW_SELF_AUTHORING=user`) or, with `all`, **prompt for approval** before writing `soul`.
7. Restore the previous `user` revision and confirm the editor updates.

Run:
```bash
cd apps/mission-control && bunx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 4: Confirm nothing else regressed**

Run:
```bash
cd libs/claw-studio && bunx vitest run
cd ../.. && bun run test
```
Expected: no new failures. Then confirm the untouched-module rule held:
```bash
git diff --stat main...HEAD -- libs/claw-studio/src/integrations libs/claw-studio/src/connectors libs/claw-studio/src/gateway libs/claw-studio/src/memory libs/claw-studio/src/skills libs/claw-studio/src/mcp libs/claw-studio/src/agent/tool-classifier.ts
```
Expected: **empty output**. Any output means a protected module was modified — revert it.

- [ ] **Step 5: Commit**

```bash
git add apps/mission-control/components/agent
git commit -m "feat(mission-control): distinguish Claw self-edits from human edits"
```

---

### Task 6: Document the self-authoring loop

**Files:**
- Modify: `libs/claw-studio/CLAUDE.md`

- [ ] **Step 1: Write the docs section**

Append to the Workspace Files section added in D1 Task 10:

```markdown
### Self-authoring

Claw edits its own workspace files through four tools in `agent/file-tools.ts`:
`list_workspace_files`, `read_workspace_file`, `write_workspace_file`, `edit_workspace_file`.

**Gating.** `write_*` and `edit_*` match `/\bwrite\b/i` in `tool-classifier.ts`, so they classify as
mutative and hit `mutative_approval_gate` for free — **do not add entries to the classifier for
these.** `createFileTools` returns a live `grantedWrites` Set that `claw-runtime.ts` passes to the
graph as `grantedTools`; the two route functions and the gate node exclude granted names. That is how
a `user` write proceeds un-prompted while a `soul` write prompts.

**Policy** (`workspace/self-authoring-policy.ts`):
- Free: `user`, `tools`, `heartbeat` — Claw learning your preferences must not nag.
- Gated: `identity`, `soul`, `agents` — rare and high-consequence.
- `CLAW_SELF_AUTHORING` = `off` | `user` (default) | `all`.
- `MAX_WRITES_PER_RUN` = 5, so a reflection loop cannot churn the soul.

**Tools never throw.** A thrown LangChain tool error aborts the whole run, so every failure path
returns a recoverable string instead. Same convention as the integration tools.

**Audit.** Every write inserts a `ClawFileRevision` carrying Claw's stated `reason` and the
`sourceRunId`. The `/agent` history dialog badges Claw's edits and offers one-click restore.
```

- [ ] **Step 2: Verify the docs against the code**

Confirm every path, export name, env value, and constant named above exists as written.

- [ ] **Step 3: Commit**

```bash
git add libs/claw-studio/CLAUDE.md
git commit -m "docs(claw-studio): document the self-authoring loop and its gating"
```

---

## Verification checklist

- [ ] `cd libs/claw-studio && bunx vitest run` — green, only additions vs the D1 count
- [ ] `cd libs/claw-studio && bunx tsc --noEmit -p tsconfig.json` — clean
- [ ] `cd apps/mission-control && bunx tsc --noEmit` — clean
- [ ] `bun run test` — no new failures
- [ ] Claw writes `user` in chat with no approval prompt
- [ ] Claw is refused on `soul` under `CLAW_SELF_AUTHORING=user`
- [ ] Claw prompts for approval on `soul` under `CLAW_SELF_AUTHORING=all`
- [ ] `CLAW_SELF_AUTHORING=off` blocks every file write
- [ ] `/agent` history badges Claw edits and restore works
- [ ] Sending an email still prompts for approval (granted tools did not widen the gate)
- [ ] `git diff --stat main...HEAD` shows **no** changes to `integrations/`, `connectors/`, `gateway/`, `memory/`, `skills/`, `mcp/`, or `tool-classifier.ts`

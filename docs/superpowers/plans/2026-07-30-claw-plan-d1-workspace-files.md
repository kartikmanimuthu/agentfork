# Claw Workspace Files (Soul & Identity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Claw a persona by replacing its hardcoded identity string with six DB-backed, human-editable, version-tracked workspace files (`identity`, `soul`, `agents`, `user`, `tools`, `heartbeat`) composed into the system prompt.

**Architecture:** Two new Prisma models (`ClawFile`, `ClawFileRevision`). A `WorkspaceFileService` owns CRUD + seeding + revisions. A pure `prompt-composer.ts` turns a file map into a prompt string, gated by "surface" so `tools` only reaches tool-bearing nodes and `heartbeat` only reaches scheduled runs. `claw-runtime.ts` loads the files and passes them to `createClawGraph`; `buildBaseIdentity()` gains an optional composed argument and falls back to today's exact string when there are no files. Mission Control gets an `/agent` page with a tabbed editor.

**Tech Stack:** TypeScript strict, Prisma + PostgreSQL, LangChain/LangGraph, Vitest, Next.js 15 App Router, shadcn/ui, Zod, T3 Env, Pino.

**Spec:** `docs/superpowers/specs/2026-07-30-claw-soul-and-cron-design.md` (§4, §7.4, §8, §9)

## Global Constraints

- **Non-regression is the hard constraint (spec §7.4).** A tenant with zero workspace files MUST produce a byte-identical prompt to today. `DEFAULT_IDENTITY` preserves the current string verbatim. Pin this with a test.
- **Do NOT modify:** `libs/claw-studio/src/integrations/**`, `libs/claw-studio/src/connectors/**`, `libs/claw-studio/src/gateway/**`, `libs/claw-studio/src/memory/**`, `libs/claw-studio/src/skills/**`, `libs/claw-studio/src/mcp/**`.
- **Only pre-existing files this plan touches:** `prisma/schema.prisma` (additive), `libs/claw-studio/src/agent/prompt-templates.ts`, `libs/claw-studio/src/agent/claw-graph.ts`, `libs/claw-studio/src/agent/claw-runtime.ts`, `libs/claw-studio/src/index.ts`, `libs/claw-studio/src/env.ts`, `apps/mission-control/lib/nav-config.ts`.
- **Char caps:** `identity` 500, `soul` 4000, `agents` 8000, `user` 4000, `tools` 2000, `heartbeat` 2000; total `CLAW_WORKSPACE_MAX_CHARS` default 16000. Over-cap truncates with a visible marker, never silently.
- **Standards (non-negotiable, from root CLAUDE.md):** Zod at every route boundary and form; all env via T3 Env (never `process.env` directly); shadcn/ui components only (no raw HTML form elements); try/catch in every route handler and service method, logging via Pino with structured context `{ tenantId, clawId, slug }`, never a bare string log.
- **Tests:** `cd libs/claw-studio && bunx vitest run` (equivalently `nx test claw-studio`). Config `include: ['src/**/*.test.ts']` resolves relative to `libs/claw-studio`, so it MUST be run with that cwd — running it from the repo root silently finds zero test files and exits 1.
- **Measured baseline before this plan (2026-07-30):** `Test Files 48 passed (48)`, `Tests 443 passed (443)`. Every task must keep all 443 green and only add to the count. If a pre-existing test breaks, stop and fix it before continuing — do not proceed with a red suite.
- **Code style:** no comments unless the *why* is non-obvious; never multi-line docstrings. Match surrounding code density.

## Mission Control UI Conventions (verified against the live app — follow exactly)

New pages must be indistinguishable from the existing ones. These were read out of
`components/skills/skills-client.tsx`, `components/memory/memories-client.tsx`, and
`components/runs/runs-client.tsx`. Do not invent alternatives.

- **Page files are thin. The heading lives in the client component, never the page.**
  ```tsx
  // app/(console)/<name>/page.tsx — this is the whole file
  export default function XPage() {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
        <XClient />
      </div>
    );
  }
  ```
- **Client shell + heading**, exactly this markup:
  ```tsx
  <div className="space-y-6">
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold">Title</h1>
        <p className="text-sm text-muted-foreground">One-line description.</p>
      </div>
      <div className="flex items-center gap-2">{/* actions */}</div>
    </div>
    {/* body */}
  </div>
  ```
  Note `text-2xl font-semibold` — **not** `text-3xl font-bold tracking-tight`.
- **Toasts are two-arg:** `toast.success("Skill deleted", { description: s.name })`,
  `toast.error("Update failed", { description: e instanceof Error ? e.message : "Try again" })`.
  Never a single interpolated string.
- **Tabular lists use `DataTable`** with `ColumnDef` from `@tanstack/react-table` and
  `DataTableColumnHeader` for sortable headers. Props in use: `columns`, `data`, `loading`,
  `enableFiltering={false}`, `defaultPageSize={10}`, `emptyMessage`, and an optional `header` node for
  a search input. Card-based lists (as in `runs-client.tsx`) are for clickable detail rows.
- **`DropdownMenuTrigger` takes a `render` prop, not `asChild`:**
  ```tsx
  <DropdownMenuTrigger render={<Button variant="ghost" className="h-8 w-8 p-0" aria-label="Open actions menu"><MoreHorizontal className="h-4 w-4" /></Button>} />
  ```
  This is a real API difference in this codebase — `asChild` will not work.
- **Icons:** lucide-react, `className="w-4 h-4 mr-1"` inside buttons.
- **Row toggles:** shadcn `Switch` with an explicit `aria-label`, disabled while the mutation is
  pending, plus a `text-xs text-muted-foreground` status word beside it.
- **Badges:** `<Badge variant="outline">` for neutral labels, `secondary` / `default` to distinguish
  system-generated from user-created.
- Read the nearest existing client component before writing a new one and mirror it.

---

### Task 1: Prisma models for workspace files

**Files:**
- Modify: `prisma/schema.prisma` (append after `ClawChannelLink`, ~line 1569; and add two back-relations to `model Claw` at ~line 1342)

**Interfaces:**
- Consumes: nothing
- Produces: Prisma models `ClawFile` (fields `id, tenantId, clawId, slug, content, version, updatedBy, createdAt, updatedAt`; unique `[clawId, slug]`) and `ClawFileRevision` (fields `id, tenantId, fileId, version, content, updatedBy, reason, sourceRunId, createdAt`; unique `[fileId, version]`). Generated client accessors `db.clawFile` and `db.clawFileRevision`.

- [ ] **Step 1: Add both models to the schema**

Append to `prisma/schema.prisma`:

```prisma
// ClawFile — Claw's DB-backed workspace files, the equivalent of OpenClaw's
// SOUL.md / AGENTS.md / IDENTITY.md / USER.md / TOOLS.md / HEARTBEAT.md. Stored
// as rows rather than files because this is a hosted multi-tenant app with no
// per-tenant volume. `updatedBy` distinguishes a human edit from Claw's own
// self-authoring write.
model ClawFile {
  id        String   @id @default(cuid())
  tenantId  String
  clawId    String
  slug      String // identity|soul|agents|user|tools|heartbeat
  content   String   @db.Text
  version   Int      @default(1)
  updatedBy String   @default("user") // user|claw
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  claw      Claw               @relation(fields: [clawId], references: [id], onDelete: Cascade)
  revisions ClawFileRevision[]

  @@unique([clawId, slug])
  @@index([tenantId])
  @@map("claw_files")
}

// ClawFileRevision — append-only history for ClawFile, so a self-authored soul
// rewrite is always diffable and revertible. `reason` is Claw's own stated
// justification, required by the write tool.
model ClawFileRevision {
  id          String   @id @default(cuid())
  tenantId    String
  fileId      String
  version     Int
  content     String   @db.Text
  updatedBy   String
  reason      String?  @db.Text
  sourceRunId String?
  createdAt   DateTime @default(now())

  file ClawFile @relation(fields: [fileId], references: [id], onDelete: Cascade)

  @@unique([fileId, version])
  @@index([tenantId])
  @@map("claw_file_revisions")
}
```

- [ ] **Step 2: Add back-relations to the existing `Claw` model**

In `model Claw`, immediately after the existing `conversations ClawConversation[]` line, add:

```prisma
  files         ClawFile[]
```

- [ ] **Step 3: Generate the client and create the migration**

Run:
```bash
bunx prisma migrate dev --name add_claw_workspace_files
```
Expected: migration created under `prisma/migrations/`, client regenerated, no errors.

- [ ] **Step 4: Verify the client has the new accessors**

Run:
```bash
bunx tsc --noEmit -p libs/claw-studio/tsconfig.json
```
Expected: PASS (no errors). This confirms `@prisma/client` types regenerated.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(claw-studio): add ClawFile and ClawFileRevision models"
```

---

### Task 2: Workspace slug constants and seed templates

**Files:**
- Create: `libs/claw-studio/src/workspace/types.ts`
- Create: `libs/claw-studio/src/workspace/templates.ts`
- Test: `libs/claw-studio/src/workspace/templates.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type WorkspaceSlug = 'identity' | 'soul' | 'agents' | 'user' | 'tools' | 'heartbeat'`
  - `const WORKSPACE_SLUGS: readonly WorkspaceSlug[]` (in the order above)
  - `const SLUG_CHAR_CAPS: Record<WorkspaceSlug, number>`
  - `const SLUG_LABELS: Record<WorkspaceSlug, { title: string; blurb: string }>`
  - `const WORKSPACE_TEMPLATES: Record<WorkspaceSlug, string>`
  - `function isWorkspaceSlug(value: unknown): value is WorkspaceSlug`

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/workspace/templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SLUG_CHAR_CAPS, SLUG_LABELS, WORKSPACE_SLUGS, isWorkspaceSlug } from './types';
import { WORKSPACE_TEMPLATES } from './templates';

describe('workspace slugs', () => {
  it('declares all six slugs in display order', () => {
    expect(WORKSPACE_SLUGS).toEqual(['identity', 'soul', 'agents', 'user', 'tools', 'heartbeat']);
  });

  it('has a cap, a label, and a template for every slug', () => {
    for (const slug of WORKSPACE_SLUGS) {
      expect(SLUG_CHAR_CAPS[slug]).toBeGreaterThan(0);
      expect(SLUG_LABELS[slug].title.length).toBeGreaterThan(0);
      expect(WORKSPACE_TEMPLATES[slug]).toBeTypeOf('string');
    }
  });

  it('ships every template within its own cap', () => {
    for (const slug of WORKSPACE_SLUGS) {
      expect(WORKSPACE_TEMPLATES[slug].length).toBeLessThanOrEqual(SLUG_CHAR_CAPS[slug]);
    }
  });

  it('guards unknown slugs', () => {
    expect(isWorkspaceSlug('soul')).toBe(true);
    expect(isWorkspaceSlug('memory')).toBe(false);
    expect(isWorkspaceSlug(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/workspace/templates.test.ts`
Expected: FAIL — cannot resolve `./types` / `./templates`.

- [ ] **Step 3: Write the implementation**

Create `libs/claw-studio/src/workspace/types.ts`:

```ts
export type WorkspaceSlug = 'identity' | 'soul' | 'agents' | 'user' | 'tools' | 'heartbeat';

export const WORKSPACE_SLUGS: readonly WorkspaceSlug[] = [
  'identity', 'soul', 'agents', 'user', 'tools', 'heartbeat',
] as const;

export const SLUG_CHAR_CAPS: Record<WorkspaceSlug, number> = {
  identity: 500,
  soul: 4000,
  agents: 8000,
  user: 4000,
  tools: 2000,
  heartbeat: 2000,
};

export const SLUG_LABELS: Record<WorkspaceSlug, { title: string; blurb: string }> = {
  identity: { title: 'Identity', blurb: 'Name, emoji, and role label.' },
  soul: { title: 'Soul', blurb: 'Persona, tone, values, and boundaries.' },
  agents: { title: 'Agents', blurb: 'Operating procedure — what Claw does and how.' },
  user: { title: 'User', blurb: 'Who Claw is helping, and their preferences.' },
  tools: { title: 'Tools', blurb: 'Environment notes and tool cautions.' },
  heartbeat: { title: 'Heartbeat', blurb: 'Checklist consulted on every scheduled run.' },
};

export function isWorkspaceSlug(value: unknown): value is WorkspaceSlug {
  return typeof value === 'string' && (WORKSPACE_SLUGS as readonly string[]).includes(value);
}

export interface WorkspaceFile {
  slug: WorkspaceSlug;
  content: string;
  version: number;
  updatedBy: string;
  updatedAt: Date;
}
```

Create `libs/claw-studio/src/workspace/templates.ts`:

```ts
import type { WorkspaceSlug } from './types';

// Seeds are deliberately short and written to be edited, not admired. Each one
// tells the user what belongs here so an empty workspace is self-explanatory.
export const WORKSPACE_TEMPLATES: Record<WorkspaceSlug, string> = {
  identity: `name: Claw
role: Autonomous teammate
emoji: 🐱
`,

  soul: `You are direct and warm. You say what you think, briefly.

You do not pad answers with filler, and you never open with a compliment. When
you are unsure, you say so plainly instead of hedging at length.

<!-- Tell Claw how to sound. Tone, values, and what it should never do. -->
`,

  agents: `## How you work

- Read the request, do the work, report what happened. No status theatre.
- Use your tools when they help. Prefer doing over describing.
- If something is genuinely ambiguous, ask one specific question.
- If a step fails twice the same way, stop and say what is blocking you.

<!-- Add the procedures Claw should follow. This is the biggest, most useful file. -->
`,

  user: `<!-- Claw fills this in as it learns about you: your role, how you like
     answers, projects you're working on, people you work with. You can edit it
     directly too. -->
`,

  tools: `<!-- Notes about this environment: which tools to prefer, which to avoid,
     account names, naming conventions, anything Claw should know before acting. -->
`,

  heartbeat: `<!-- Read on every scheduled run, before the task itself.
     Put standing checks here, e.g. "always report the no-op case explicitly". -->
`,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/claw-studio && bunx vitest run src/workspace/templates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/workspace
git commit -m "feat(claw-studio): add workspace slug constants and seed templates"
```

---

### Task 3: The prompt composer

**Files:**
- Create: `libs/claw-studio/src/agent/prompt-composer.ts`
- Test: `libs/claw-studio/src/agent/prompt-composer.test.ts`

**Interfaces:**
- Consumes: `WorkspaceSlug`, `SLUG_CHAR_CAPS` from Task 2
- Produces:
  - `type PromptSurface = 'speaking' | 'acting' | 'scheduled'`
  - `interface ComposeInput { files: Map<WorkspaceSlug, string>; surface: PromptSurface; agentsOverride?: string; totalCap?: number }`
  - `function composeIdentity(input: ComposeInput): string`
  - `const SURFACE_SLUGS: Record<PromptSurface, readonly WorkspaceSlug[]>`

Surface rules (spec §4.1): `speaking` = identity, soul, agents, user. `acting` = those plus `tools`. `scheduled` = acting plus `heartbeat`.

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/agent/prompt-composer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { composeIdentity } from './prompt-composer';
import type { WorkspaceSlug } from '../workspace/types';

const files = (entries: Partial<Record<WorkspaceSlug, string>>) =>
  new Map(Object.entries(entries) as Array<[WorkspaceSlug, string]>);

describe('composeIdentity', () => {
  it('returns an empty string when there are no files', () => {
    expect(composeIdentity({ files: files({}), surface: 'speaking' })).toBe('');
  });

  it('emits sections in a fixed order', () => {
    const out = composeIdentity({
      files: files({ agents: 'PROC', identity: 'ID', user: 'USR', soul: 'SOUL' }),
      surface: 'speaking',
    });
    expect(out.indexOf('ID')).toBeLessThan(out.indexOf('SOUL'));
    expect(out.indexOf('SOUL')).toBeLessThan(out.indexOf('PROC'));
    expect(out.indexOf('PROC')).toBeLessThan(out.indexOf('USR'));
  });

  it('omits empty and whitespace-only files entirely', () => {
    const out = composeIdentity({ files: files({ soul: 'SOUL', user: '   ' }), surface: 'speaking' });
    expect(out).toContain('SOUL');
    expect(out).not.toContain("WHO YOU'RE HELPING");
  });

  it('excludes tools on the speaking surface and includes it on acting', () => {
    const f = files({ soul: 'SOUL', tools: 'ENVNOTE' });
    expect(composeIdentity({ files: f, surface: 'speaking' })).not.toContain('ENVNOTE');
    expect(composeIdentity({ files: f, surface: 'acting' })).toContain('ENVNOTE');
  });

  it('includes heartbeat only on the scheduled surface', () => {
    const f = files({ soul: 'SOUL', heartbeat: 'CHECKLIST' });
    expect(composeIdentity({ files: f, surface: 'acting' })).not.toContain('CHECKLIST');
    expect(composeIdentity({ files: f, surface: 'scheduled' })).toContain('CHECKLIST');
  });

  it('lets agentsOverride replace the agents file', () => {
    const out = composeIdentity({
      files: files({ agents: 'SAVED' }),
      surface: 'speaking',
      agentsOverride: 'OVERRIDDEN',
    });
    expect(out).toContain('OVERRIDDEN');
    expect(out).not.toContain('SAVED');
  });

  it('uses agentsOverride even when no agents file exists', () => {
    const out = composeIdentity({ files: files({}), surface: 'speaking', agentsOverride: 'ONLY' });
    expect(out).toContain('ONLY');
  });

  it('truncates a single over-cap file with a visible marker', () => {
    const out = composeIdentity({ files: files({ soul: 'x'.repeat(5000) }), surface: 'speaking' });
    expect(out).toContain('<!-- truncated: soul exceeded 4000 chars -->');
    expect(out).not.toContain('x'.repeat(4001));
  });

  it('truncates against the total cap with a visible marker', () => {
    const out = composeIdentity({
      files: files({ soul: 'a'.repeat(400), agents: 'b'.repeat(400) }),
      surface: 'speaking',
      totalCap: 500,
    });
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out).toContain('<!-- truncated: workspace exceeded 500 chars -->');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/prompt-composer.test.ts`
Expected: FAIL — cannot resolve `./prompt-composer`.

- [ ] **Step 3: Write the implementation**

Create `libs/claw-studio/src/agent/prompt-composer.ts`:

```ts
import { SLUG_CHAR_CAPS, type WorkspaceSlug } from '../workspace/types';

export type PromptSurface = 'speaking' | 'acting' | 'scheduled';

const SPEAKING: readonly WorkspaceSlug[] = ['identity', 'soul', 'agents', 'user'];

export const SURFACE_SLUGS: Record<PromptSurface, readonly WorkspaceSlug[]> = {
  speaking: SPEAKING,
  acting: [...SPEAKING, 'tools'],
  scheduled: [...SPEAKING, 'tools', 'heartbeat'],
};

const HEADINGS: Record<WorkspaceSlug, string> = {
  identity: 'WHO YOU ARE',
  soul: 'YOUR CHARACTER',
  agents: 'HOW YOU WORK',
  user: "WHO YOU'RE HELPING",
  tools: 'YOUR ENVIRONMENT',
  heartbeat: 'EVERY SCHEDULED RUN',
};

export const DEFAULT_TOTAL_CAP = 16_000;

export interface ComposeInput {
  files: Map<WorkspaceSlug, string>;
  surface: PromptSurface;
  /** Replaces the `agents` file for this run only — carries deps.systemPrompt. */
  agentsOverride?: string;
  totalCap?: number;
}

function capped(slug: WorkspaceSlug, text: string): string {
  const cap = SLUG_CHAR_CAPS[slug];
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}\n<!-- truncated: ${slug} exceeded ${cap} chars -->`;
}

export function composeIdentity(input: ComposeInput): string {
  const { files, surface, agentsOverride, totalCap = DEFAULT_TOTAL_CAP } = input;

  const sections: string[] = [];
  for (const slug of SURFACE_SLUGS[surface]) {
    const raw = slug === 'agents' ? (agentsOverride ?? files.get(slug)) : files.get(slug);
    if (!raw || !raw.trim()) continue;
    sections.push(`=== ${HEADINGS[slug]} ===\n${capped(slug, raw.trim())}`);
  }

  const composed = sections.join('\n\n');
  if (composed.length <= totalCap) return composed;
  return `${composed.slice(0, totalCap)}\n<!-- truncated: workspace exceeded ${totalCap} chars -->`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/claw-studio && bunx vitest run src/agent/prompt-composer.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/agent/prompt-composer.ts libs/claw-studio/src/agent/prompt-composer.test.ts
git commit -m "feat(claw-studio): add workspace prompt composer"
```

---

### Task 4: `buildBaseIdentity` accepts the composed prompt

**Files:**
- Modify: `libs/claw-studio/src/agent/prompt-templates.ts:45-50`
- Test: `libs/claw-studio/src/agent/prompt-templates.test.ts` (extend the existing file)

**Interfaces:**
- Consumes: nothing
- Produces: `buildBaseIdentity(selectedSkill?: string | null, composed?: string): string` and `const DEFAULT_IDENTITY: string`

**Critical:** `DEFAULT_IDENTITY` must be today's string **verbatim**. This is the non-regression guarantee.

- [ ] **Step 1: Write the failing test**

Append to `libs/claw-studio/src/agent/prompt-templates.test.ts`:

```ts
describe('buildBaseIdentity with a composed workspace', () => {
  it('falls back to the default identity when nothing is composed', () => {
    expect(buildBaseIdentity()).toBe(DEFAULT_IDENTITY);
    expect(buildBaseIdentity(null, '')).toBe(DEFAULT_IDENTITY);
    expect(buildBaseIdentity(null, '   ')).toBe(DEFAULT_IDENTITY);
  });

  it('preserves the pre-change default string verbatim', () => {
    expect(DEFAULT_IDENTITY).toBe(
      'You are Claw, a helpful AI assistant. You have persistent memory and can use any tools the user has connected. Help the user with whatever they ask, doing tasks directly with your tools when that helps.',
    );
  });

  it('returns the composed workspace when one is supplied', () => {
    expect(buildBaseIdentity(null, '=== WHO YOU ARE ===\nAda')).toContain('Ada');
  });

  it('lets an active skill still override the composed workspace', () => {
    expect(buildBaseIdentity('deploy', '=== WHO YOU ARE ===\nAda')).toBe(
      'You are an expert AI agent operating under the "deploy" skill.',
    );
  });
});
```

Ensure the file's import line includes both names, e.g.
`import { CORE_PRINCIPLES, DEFAULT_IDENTITY, buildBaseIdentity, buildEffectiveSkillSection } from './prompt-templates';`

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/prompt-templates.test.ts`
Expected: FAIL — `DEFAULT_IDENTITY` is not exported.

- [ ] **Step 3: Write the implementation**

In `libs/claw-studio/src/agent/prompt-templates.ts`, replace the `buildBaseIdentity` function with:

```ts
export const DEFAULT_IDENTITY =
  'You are Claw, a helpful AI assistant. You have persistent memory and can use any tools the user has connected. Help the user with whatever they ask, doing tasks directly with your tools when that helps.';

export function buildBaseIdentity(selectedSkill?: string | null, composed?: string): string {
  if (selectedSkill) {
    return `You are an expert AI agent operating under the "${selectedSkill}" skill.`;
  }
  return composed?.trim() || DEFAULT_IDENTITY;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/claw-studio && bunx vitest run src/agent/prompt-templates.test.ts`
Expected: PASS, including all pre-existing tests in the file.

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/agent/prompt-templates.ts libs/claw-studio/src/agent/prompt-templates.test.ts
git commit -m "feat(claw-studio): buildBaseIdentity accepts a composed workspace identity"
```

---

### Task 5: Wire the composer into the graph (fixes the shadowing bug)

**Files:**
- Modify: `libs/claw-studio/src/agent/claw-graph.ts` (deps interface ~line 74; destructure ~line 108; the four `buildBaseIdentity` call sites at lines 272, 338, 552, 596)
- Test: `libs/claw-studio/src/agent/claw-graph.test.ts` (extend)

**Interfaces:**
- Consumes: `composeIdentity`, `PromptSurface` (Task 3); `buildBaseIdentity` (Task 4)
- Produces: `ClawGraphDeps` gains `workspaceFiles?: Map<WorkspaceSlug, string>` and `promptSurface?: PromptSurface` (default `'acting'`). `deps.systemPrompt` is now consumed as `agentsOverride`.

**Background (spec §2.2a):** `deps.systemPrompt` is currently destructured at line 108 and then shadowed by a local `const systemPrompt = new SystemMessage(...)` in every node, so it is dead code. This task makes it live.

Node → surface mapping (spec §D9): `planner` and `final` use `'speaking'`; `generate` and `revise` use `'acting'` (they bind tools). `evaluator` and `reflect` are internal classifiers and are NOT changed.

- [ ] **Step 1: Write the failing test**

Append to `libs/claw-studio/src/agent/claw-graph.test.ts`:

```ts
describe('workspace identity injection', () => {
  it('injects the composed workspace into the generate node system prompt', async () => {
    const captured: string[] = [];
    const model = makeModel((messages) => {
      captured.push(String(messages[0].content));
      return new AIMessage({ content: 'done' });
    });

    const graph = createClawGraph({
      model,
      tenantId: 't1',
      userId: 'c1',
      autoApprove: true,
      workspaceFiles: new Map([['soul', 'You are terse and dry.']]),
    });

    await graph.invoke({ messages: [new HumanMessage('hi')] });
    expect(captured.some((p) => p.includes('You are terse and dry.'))).toBe(true);
  });

  it('falls back to DEFAULT_IDENTITY when no workspace files are supplied', async () => {
    const captured: string[] = [];
    const model = makeModel((messages) => {
      captured.push(String(messages[0].content));
      return new AIMessage({ content: 'done' });
    });

    const graph = createClawGraph({ model, tenantId: 't1', userId: 'c1', autoApprove: true });
    await graph.invoke({ messages: [new HumanMessage('hi')] });
    expect(captured.some((p) => p.includes(DEFAULT_IDENTITY))).toBe(true);
  });

  it('uses deps.systemPrompt as the agents override (previously dead code)', async () => {
    const captured: string[] = [];
    const model = makeModel((messages) => {
      captured.push(String(messages[0].content));
      return new AIMessage({ content: 'done' });
    });

    const graph = createClawGraph({
      model,
      tenantId: 't1',
      userId: 'c1',
      autoApprove: true,
      systemPrompt: 'ALWAYS reply in haiku.',
      workspaceFiles: new Map([['agents', 'saved procedure']]),
    });

    await graph.invoke({ messages: [new HumanMessage('hi')] });
    expect(captured.some((p) => p.includes('ALWAYS reply in haiku.'))).toBe(true);
    expect(captured.some((p) => p.includes('saved procedure'))).toBe(false);
  });
});
```

Reuse the existing file's model-stub helper. If it has no such helper, define `makeModel` locally following the pattern already used by the other tests in that file, and import `AIMessage` / `HumanMessage` from `@langchain/core/messages` and `DEFAULT_IDENTITY` from `./prompt-templates`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/claw-graph.test.ts`
Expected: FAIL — `workspaceFiles` is not a known dep; composed soul is absent from prompts.

- [ ] **Step 3: Write the implementation**

In `libs/claw-studio/src/agent/claw-graph.ts`:

(a) Add the imports:

```ts
import { composeIdentity, type PromptSurface } from './prompt-composer';
import type { WorkspaceSlug } from '../workspace/types';
```

(b) In `ClawGraphDeps`, after the existing `systemPrompt?: string;` line, add:

```ts
  workspaceFiles?: Map<WorkspaceSlug, string>;
  promptSurface?: PromptSurface;
```

(c) In the `createClawGraph` destructure (~line 108), add `workspaceFiles`, `promptSurface`:

```ts
  const {
    model, systemPrompt, tenantId, userId, store,
    autoApprove = false, maxIterations = DEFAULT_MAX_ITERATIONS,
    workspaceFiles, promptSurface,
  } = deps;
```

(d) Immediately after the destructure, add the two memoised composed strings. Composing once per graph build (not per node call) keeps this off the hot path:

```ts
  const files = workspaceFiles ?? new Map<WorkspaceSlug, string>();
  const baseSurface: PromptSurface = promptSurface ?? 'acting';
  const composedSpeaking = composeIdentity({
    files, surface: baseSurface === 'scheduled' ? 'scheduled' : 'speaking', agentsOverride: systemPrompt,
  });
  const composedActing = composeIdentity({ files, surface: baseSurface, agentsOverride: systemPrompt });
```

(e) Update the four `buildBaseIdentity` call sites. At lines 272 (`planner`) and 596 (`final`):

```ts
    const baseIdentity = buildBaseIdentity(state.evaluation?.skillId, composedSpeaking);
```

(the `final` node uses `evaluation?.skillId` rather than `state.evaluation?.skillId` — keep whichever expression is already there, only add the second argument)

At lines 338 (`generate`) and 552 (`revise`):

```ts
    const baseIdentity = buildBaseIdentity(evaluation?.skillId, composedActing);
```

Leave the `evaluator` (line 167) and `reflect` (line 452) prompts completely untouched.

- [ ] **Step 4: Run the full lib suite to verify nothing regressed**

Run: `cd libs/claw-studio && bunx vitest run`
Expected: PASS — the three new tests plus every pre-existing test. Compare the total count against the baseline captured before this plan began.

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/agent/claw-graph.ts libs/claw-studio/src/agent/claw-graph.test.ts
git commit -m "feat(claw-studio): compose workspace identity into graph prompts

Also fixes deps.systemPrompt being shadowed and silently discarded by every
node, which made Claw.systemPrompt and Playground overrides dead code."
```

---

### Task 6: `WorkspaceFileService`

**Files:**
- Create: `libs/claw-studio/src/workspace/workspace-file-service.ts`
- Test: `libs/claw-studio/src/workspace/workspace-file-service.test.ts`

**Interfaces:**
- Consumes: `WorkspaceSlug`, `WORKSPACE_SLUGS`, `SLUG_CHAR_CAPS`, `WorkspaceFile` (Task 2); `WORKSPACE_TEMPLATES` (Task 2)
- Produces:
  ```ts
  class WorkspaceFileService {
    constructor(tenantId: string, clawId: string, db?: PrismaClient);
    seed(): Promise<void>;
    list(): Promise<WorkspaceFile[]>;
    read(slug: WorkspaceSlug): Promise<WorkspaceFile | null>;
    asMap(): Promise<Map<WorkspaceSlug, string>>;
    write(slug: WorkspaceSlug, content: string, opts: { updatedBy: 'user' | 'claw'; reason?: string; sourceRunId?: string }): Promise<WorkspaceFile>;
    revisions(slug: WorkspaceSlug): Promise<Array<{ version: number; updatedBy: string; reason: string | null; createdAt: Date }>>;
    restore(slug: WorkspaceSlug, version: number): Promise<WorkspaceFile>;
  }
  function getWorkspaceFileService(tenantId: string, clawId: string): WorkspaceFileService;
  ```

Behaviour: `write` rejects content over `SLUG_CHAR_CAPS[slug]` by throwing `WorkspaceFileTooLargeError`. Each `write` increments `version` and inserts a `ClawFileRevision` **in one transaction**. `restore` reads the revision and writes its content as a new version (never rewinds `version`), so history is append-only. `seed` is idempotent.

- [ ] **Step 1: Write the failing test**

Create `libs/claw-studio/src/workspace/workspace-file-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceFileService, WorkspaceFileTooLargeError } from './workspace-file-service';
import { WORKSPACE_TEMPLATES } from './templates';

function makeDb() {
  const files = new Map<string, { id: string; slug: string; content: string; version: number; updatedBy: string; updatedAt: Date }>();
  const revisions: Array<Record<string, unknown>> = [];
  let seq = 0;

  const clawFile = {
    findMany: vi.fn(async () => [...files.values()]),
    findUnique: vi.fn(async ({ where }: any) => files.get(where.clawId_slug.slug) ?? null),
    createMany: vi.fn(async ({ data }: any) => {
      for (const row of data) {
        if (files.has(row.slug)) continue;
        files.set(row.slug, { id: `f${++seq}`, version: 1, updatedBy: 'user', updatedAt: new Date(), ...row });
      }
      return { count: data.length };
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const slug = where.clawId_slug.slug;
      const existing = files.get(slug);
      const next = existing
        ? { ...existing, ...update, version: existing.version + 1, updatedAt: new Date() }
        : { id: `f${++seq}`, version: 1, updatedAt: new Date(), ...create };
      files.set(slug, next);
      return next;
    }),
  };

  const clawFileRevision = {
    create: vi.fn(async ({ data }: any) => { revisions.push(data); return data; }),
    findMany: vi.fn(async () => [...revisions].reverse()),
    findFirst: vi.fn(async ({ where }: any) =>
      revisions.find((r) => r.version === where.version) ?? null),
  };

  const db: any = { clawFile, clawFileRevision };
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  return { db, files, revisions };
}

describe('WorkspaceFileService', () => {
  let harness: ReturnType<typeof makeDb>;
  let svc: WorkspaceFileService;

  beforeEach(() => {
    harness = makeDb();
    svc = new WorkspaceFileService('t1', 'c1', harness.db);
  });

  it('seeds all six templates', async () => {
    await svc.seed();
    expect(harness.db.clawFile.createMany).toHaveBeenCalledOnce();
    const rows = harness.db.clawFile.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(6);
    expect(rows.find((r: any) => r.slug === 'soul').content).toBe(WORKSPACE_TEMPLATES.soul);
  });

  it('seeds idempotently', async () => {
    await svc.seed();
    await svc.seed();
    expect(harness.files.size).toBe(6);
  });

  it('exposes files as a slug→content map', async () => {
    await svc.seed();
    const map = await svc.asMap();
    expect(map.get('soul')).toBe(WORKSPACE_TEMPLATES.soul);
  });

  it('bumps version and records a revision on write', async () => {
    await svc.seed();
    const result = await svc.write('soul', 'New soul.', { updatedBy: 'claw', reason: 'learned tone' });
    expect(result.version).toBe(2);
    expect(harness.revisions).toHaveLength(1);
    expect(harness.revisions[0]).toMatchObject({ updatedBy: 'claw', reason: 'learned tone', content: 'New soul.' });
  });

  it('rejects content over the slug cap', async () => {
    await svc.seed();
    await expect(svc.write('identity', 'x'.repeat(501), { updatedBy: 'user' }))
      .rejects.toThrow(WorkspaceFileTooLargeError);
  });

  it('restores a revision as a new version rather than rewinding', async () => {
    await svc.seed();
    await svc.write('soul', 'v2 content', { updatedBy: 'user' });
    await svc.write('soul', 'v3 content', { updatedBy: 'user' });
    const restored = await svc.restore('soul', 2);
    expect(restored.content).toBe('v2 content');
    expect(restored.version).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/workspace/workspace-file-service.test.ts`
Expected: FAIL — cannot resolve `./workspace-file-service`.

- [ ] **Step 3: Write the implementation**

Create `libs/claw-studio/src/workspace/workspace-file-service.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import { createLogger, getPrismaClient } from '@chatbot/shared';
import { WORKSPACE_TEMPLATES } from './templates';
import { SLUG_CHAR_CAPS, WORKSPACE_SLUGS, type WorkspaceFile, type WorkspaceSlug } from './types';

const logger = createLogger('claw-studio:workspace');

export class WorkspaceFileTooLargeError extends Error {
  constructor(slug: WorkspaceSlug, length: number) {
    super(`${slug} is ${length} chars, over the ${SLUG_CHAR_CAPS[slug]} limit`);
    this.name = 'WorkspaceFileTooLargeError';
  }
}

export class WorkspaceFileNotFoundError extends Error {
  constructor(slug: WorkspaceSlug) {
    super(`Workspace file "${slug}" does not exist`);
    this.name = 'WorkspaceFileNotFoundError';
  }
}

interface WriteOpts {
  updatedBy: 'user' | 'claw';
  reason?: string;
  sourceRunId?: string;
}

export class WorkspaceFileService {
  private readonly db: PrismaClient;

  constructor(
    private readonly tenantId: string,
    private readonly clawId: string,
    db?: PrismaClient,
  ) {
    this.db = db ?? getPrismaClient();
  }

  async seed(): Promise<void> {
    try {
      await this.db.clawFile.createMany({
        data: WORKSPACE_SLUGS.map((slug) => ({
          tenantId: this.tenantId,
          clawId: this.clawId,
          slug,
          content: WORKSPACE_TEMPLATES[slug],
        })),
        skipDuplicates: true,
      });
      logger.info({ tenantId: this.tenantId, clawId: this.clawId }, 'Seeded workspace files');
    } catch (error) {
      logger.error({ error, tenantId: this.tenantId, clawId: this.clawId }, 'Failed to seed workspace files');
      throw error;
    }
  }

  async list(): Promise<WorkspaceFile[]> {
    try {
      const rows = await this.db.clawFile.findMany({ where: { clawId: this.clawId } });
      const order = new Map(WORKSPACE_SLUGS.map((s, i) => [s as string, i]));
      return rows
        .map((r) => ({
          slug: r.slug as WorkspaceSlug,
          content: r.content,
          version: r.version,
          updatedBy: r.updatedBy,
          updatedAt: r.updatedAt,
        }))
        .sort((a, b) => (order.get(a.slug) ?? 99) - (order.get(b.slug) ?? 99));
    } catch (error) {
      logger.error({ error, tenantId: this.tenantId, clawId: this.clawId }, 'Failed to list workspace files');
      throw error;
    }
  }

  async read(slug: WorkspaceSlug): Promise<WorkspaceFile | null> {
    try {
      const row = await this.db.clawFile.findUnique({
        where: { clawId_slug: { clawId: this.clawId, slug } },
      });
      if (!row) return null;
      return {
        slug, content: row.content, version: row.version,
        updatedBy: row.updatedBy, updatedAt: row.updatedAt,
      };
    } catch (error) {
      logger.error({ error, tenantId: this.tenantId, clawId: this.clawId, slug }, 'Failed to read workspace file');
      throw error;
    }
  }

  async asMap(): Promise<Map<WorkspaceSlug, string>> {
    const files = await this.list();
    return new Map(files.map((f) => [f.slug, f.content]));
  }

  async write(slug: WorkspaceSlug, content: string, opts: WriteOpts): Promise<WorkspaceFile> {
    if (content.length > SLUG_CHAR_CAPS[slug]) {
      throw new WorkspaceFileTooLargeError(slug, content.length);
    }
    try {
      return await this.db.$transaction(async (tx) => {
        const row = await tx.clawFile.upsert({
          where: { clawId_slug: { clawId: this.clawId, slug } },
          create: {
            tenantId: this.tenantId, clawId: this.clawId, slug,
            content, updatedBy: opts.updatedBy,
          },
          update: { content, updatedBy: opts.updatedBy, version: { increment: 1 } },
        });
        await tx.clawFileRevision.create({
          data: {
            tenantId: this.tenantId,
            fileId: row.id,
            version: row.version,
            content,
            updatedBy: opts.updatedBy,
            reason: opts.reason ?? null,
            sourceRunId: opts.sourceRunId ?? null,
          },
        });
        logger.info(
          { tenantId: this.tenantId, clawId: this.clawId, slug, version: row.version, updatedBy: opts.updatedBy },
          'Wrote workspace file',
        );
        return {
          slug, content: row.content, version: row.version,
          updatedBy: row.updatedBy, updatedAt: row.updatedAt,
        };
      });
    } catch (error) {
      logger.error({ error, tenantId: this.tenantId, clawId: this.clawId, slug }, 'Failed to write workspace file');
      throw error;
    }
  }

  async revisions(slug: WorkspaceSlug) {
    try {
      const file = await this.db.clawFile.findUnique({
        where: { clawId_slug: { clawId: this.clawId, slug } },
      });
      if (!file) return [];
      return await this.db.clawFileRevision.findMany({
        where: { fileId: file.id },
        orderBy: { version: 'desc' },
        select: { version: true, updatedBy: true, reason: true, createdAt: true },
      });
    } catch (error) {
      logger.error({ error, tenantId: this.tenantId, clawId: this.clawId, slug }, 'Failed to list revisions');
      throw error;
    }
  }

  async restore(slug: WorkspaceSlug, version: number): Promise<WorkspaceFile> {
    try {
      const file = await this.db.clawFile.findUnique({
        where: { clawId_slug: { clawId: this.clawId, slug } },
      });
      if (!file) throw new WorkspaceFileNotFoundError(slug);
      const revision = await this.db.clawFileRevision.findFirst({
        where: { fileId: file.id, version },
      });
      if (!revision) throw new WorkspaceFileNotFoundError(slug);
      return await this.write(slug, revision.content, {
        updatedBy: 'user',
        reason: `Restored version ${version}`,
      });
    } catch (error) {
      logger.error({ error, tenantId: this.tenantId, clawId: this.clawId, slug, version }, 'Failed to restore revision');
      throw error;
    }
  }
}

export function getWorkspaceFileService(tenantId: string, clawId: string): WorkspaceFileService {
  return new WorkspaceFileService(tenantId, clawId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd libs/claw-studio && bunx vitest run src/workspace/workspace-file-service.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/workspace/workspace-file-service.ts libs/claw-studio/src/workspace/workspace-file-service.test.ts
git commit -m "feat(claw-studio): add WorkspaceFileService with revisions and restore"
```

---

### Task 7: Load workspace files in the runtime

**Files:**
- Modify: `libs/claw-studio/src/agent/claw-runtime.ts` (add the load ~line 148 beside `loadAllSkillContent`; pass into `createClawGraph` ~line 155)
- Modify: `libs/claw-studio/src/env.ts` (add `CLAW_WORKSPACE_MAX_CHARS`)
- Modify: `libs/claw-studio/src/index.ts` (export the new public surface)
- Test: `libs/claw-studio/src/agent/claw-runtime.test.ts` (extend)

**Interfaces:**
- Consumes: `WorkspaceFileService` (Task 6); `createClawGraph` deps (Task 5)
- Produces: `ResolveClawRuntimeInput` gains `promptSurface?: PromptSurface`. `resolveClawRuntime` seeds files on first use and passes `workspaceFiles` to the graph.

- [ ] **Step 1: Write the failing test**

Append to `libs/claw-studio/src/agent/claw-runtime.test.ts`, following that file's existing Prisma-mock pattern:

```ts
describe('workspace file loading', () => {
  it('passes the loaded workspace files into the graph', async () => {
    // Arrange the existing harness so clawFile.findMany returns one soul row.
    // Then assert createClawGraph received workspaceFiles with that content.
    const runtime = await resolveClawRuntime({ tenantId: 't1' });
    expect(runtime).toBeDefined();
    expect(createClawGraphSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceFiles: expect.any(Map),
      }),
    );
    const passed = createClawGraphSpy.mock.calls.at(-1)![0].workspaceFiles as Map<string, string>;
    expect(passed.get('soul')).toBe('Terse and dry.');
  });
});
```

Match the mocking style already used in that file — it mocks `./claw-graph`, so extend the existing `vi.mock` rather than adding a second one, and name the spy consistently with what is already there.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/claw-studio && bunx vitest run src/agent/claw-runtime.test.ts`
Expected: FAIL — `workspaceFiles` is not passed.

- [ ] **Step 3: Write the implementation**

(a) In `libs/claw-studio/src/env.ts`, add inside `server`:

```ts
    CLAW_WORKSPACE_MAX_CHARS: z.coerce.number().int().positive().default(16_000),
```

(b) In `libs/claw-studio/src/agent/claw-runtime.ts`, add the import:

```ts
import { WorkspaceFileService } from '../workspace/workspace-file-service';
import type { PromptSurface } from './prompt-composer';
```

(c) Add to `ResolveClawRuntimeInput`:

```ts
  /** Scheduled runs pass 'scheduled' so HEARTBEAT is injected. Defaults to 'acting'. */
  promptSurface?: PromptSurface;
```

(d) Destructure it alongside the others in `resolveClawRuntime`:

```ts
  const { tenantId, threadId: threadIdOverride, maxIterations = MAX_ITERATIONS, overrides, promptSurface } = input;
```

(e) After the `skillContentMap` load, add the workspace load. Seed-then-read makes an existing tenant self-heal on first access, matching how the function already auto-provisions a missing Claw:

```ts
    const workspace = new WorkspaceFileService(tenantId, claw.id, db);
    await workspace.seed();
    const workspaceFiles = await workspace.asMap();
```

(f) Add both to the `createClawGraph` call:

```ts
      skillContentMap,
      maxIterations,
      workspaceFiles,
      promptSurface,
```

(g) In `libs/claw-studio/src/index.ts`, add:

```ts
export { composeIdentity, SURFACE_SLUGS, DEFAULT_TOTAL_CAP } from './agent/prompt-composer';
export type { PromptSurface, ComposeInput } from './agent/prompt-composer';

export { DEFAULT_IDENTITY } from './agent/prompt-templates';

export {
  WorkspaceFileService, getWorkspaceFileService,
  WorkspaceFileTooLargeError, WorkspaceFileNotFoundError,
} from './workspace/workspace-file-service';
export {
  WORKSPACE_SLUGS, SLUG_CHAR_CAPS, SLUG_LABELS, isWorkspaceSlug,
} from './workspace/types';
export type { WorkspaceSlug, WorkspaceFile } from './workspace/types';
export { WORKSPACE_TEMPLATES } from './workspace/templates';
```

Add `DEFAULT_IDENTITY` to the existing `prompt-templates` export block rather than creating a duplicate export statement if one already covers that module.

- [ ] **Step 4: Run the full suite and typecheck**

Run:
```bash
cd libs/claw-studio && bunx vitest run && bunx tsc --noEmit -p tsconfig.json
```
Expected: both PASS, no new failures vs baseline.

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/src/agent/claw-runtime.ts libs/claw-studio/src/agent/claw-runtime.test.ts libs/claw-studio/src/env.ts libs/claw-studio/src/index.ts
git commit -m "feat(claw-studio): load workspace files in resolveClawRuntime"
```

---

### Task 8: Mission Control API routes

**Files:**
- Create: `apps/mission-control/app/api/files/route.ts`
- Create: `apps/mission-control/app/api/files/[slug]/route.ts`
- Create: `apps/mission-control/app/api/files/[slug]/revisions/route.ts`
- Create: `apps/mission-control/app/api/files/[slug]/revisions/[version]/restore/route.ts`
- Create: `apps/mission-control/lib/claw-resolver.ts`

**Interfaces:**
- Consumes: `WorkspaceFileService`, `isWorkspaceSlug`, `WorkspaceFileTooLargeError` from `@chatbot/claw-studio` (Task 7)
- Produces: `resolveClawForSession(): Promise<{ tenantId: string; clawId: string }>` in `lib/claw-resolver.ts`. Routes returning `{ success: true, data }` / `{ success: false, error }`, matching the existing mission-control route convention.

Read an existing route (e.g. `apps/mission-control/app/api/skills/route.ts`) first and mirror its session-resolution, Zod, logging, and response shape exactly.

- [ ] **Step 1: Add the shared Claw resolver**

Create `apps/mission-control/lib/claw-resolver.ts`:

```ts
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { auth } from './auth';

const logger = createLogger('mission-control:claw-resolver');

export class ClawNotProvisionedError extends Error {
  constructor() {
    super('No Claw provisioned for this tenant');
    this.name = 'ClawNotProvisionedError';
  }
}

export async function resolveClawForSession(): Promise<{ tenantId: string; clawId: string }> {
  try {
    const session = await getServerSession(authOptions);
    // Mission Control has its OWN NextAuth Credentials login (Studio ID + password),
    // and its JWT puts the ids under `session.studio` — not `session.user`.
    const tenantId = session?.studio?.tenantId;
    const clawId = session?.studio?.clawId;
    if (!tenantId) throw new Error('No tenant in session');
    if (clawId) return { tenantId, clawId };

    const studio = await getPrismaClient().clawStudio.findFirst({
      where: { tenantId },
      include: { claws: true },
    });
    const resolved = studio?.claws[0]?.id;
    if (!resolved) throw new ClawNotProvisionedError();
    return { tenantId, clawId: resolved };
  } catch (error) {
    logger.error({ error }, 'Failed to resolve Claw for session');
    throw error;
  }
}
```

**Verified facts to build against — do not guess these:**
- `apps/mission-control/middleware.ts` states plainly that MC *"does not trust web-ui's session"*. It
  guards pages only; API routes self-guard via `getServerSession` and return 401, which is why the
  matcher excludes `/api`.
- MC's JWT carries `{ studioId, tenantId, clawId, studioRecordId }` and the session callback exposes
  them as `session.studio` (see `lib/auth.ts` and `types/next-auth.d.ts`).
- `clawId` is already on the session, so the DB lookup above is only a fallback for older tokens.

Read `apps/mission-control/lib/auth.ts` and `types/next-auth.d.ts` to confirm the exact export names
(`authOptions` vs a helper) before writing, and match an existing route's import style.

- [ ] **Step 2: Write the list and read/write routes**

Create `apps/mission-control/app/api/files/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createLogger } from '@chatbot/shared';
import { WorkspaceFileService, SLUG_LABELS, SLUG_CHAR_CAPS } from '@chatbot/claw-studio';
import { resolveClawForSession } from '@/lib/claw-resolver';

const logger = createLogger('mission-control:api:files');

export async function GET() {
  try {
    const { tenantId, clawId } = await resolveClawForSession();
    const svc = new WorkspaceFileService(tenantId, clawId);
    await svc.seed();
    const files = await svc.list();
    return NextResponse.json({
      success: true,
      data: files.map((f) => ({
        ...f,
        label: SLUG_LABELS[f.slug],
        charCap: SLUG_CHAR_CAPS[f.slug],
      })),
    });
  } catch (error) {
    logger.error({ error }, 'GET /api/files failed');
    return NextResponse.json({ success: false, error: 'Failed to load workspace files' }, { status: 500 });
  }
}
```

Create `apps/mission-control/app/api/files/[slug]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { WorkspaceFileService, WorkspaceFileTooLargeError, isWorkspaceSlug } from '@chatbot/claw-studio';
import { resolveClawForSession } from '@/lib/claw-resolver';

const logger = createLogger('mission-control:api:files:slug');

const putSchema = z.object({ content: z.string().max(20_000) });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    if (!isWorkspaceSlug(slug)) {
      return NextResponse.json({ success: false, error: 'Unknown workspace file' }, { status: 404 });
    }
    const { tenantId, clawId } = await resolveClawForSession();
    const file = await new WorkspaceFileService(tenantId, clawId).read(slug);
    if (!file) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: file });
  } catch (error) {
    logger.error({ error, slug }, 'GET /api/files/[slug] failed');
    return NextResponse.json({ success: false, error: 'Failed to read workspace file' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    if (!isWorkspaceSlug(slug)) {
      return NextResponse.json({ success: false, error: 'Unknown workspace file' }, { status: 404 });
    }
    const parsed = putSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { tenantId, clawId } = await resolveClawForSession();
    const file = await new WorkspaceFileService(tenantId, clawId)
      .write(slug, parsed.data.content, { updatedBy: 'user' });
    logger.info({ tenantId, clawId, slug, version: file.version }, 'Workspace file saved');
    return NextResponse.json({ success: true, data: file });
  } catch (error) {
    if (error instanceof WorkspaceFileTooLargeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    logger.error({ error, slug }, 'PUT /api/files/[slug] failed');
    return NextResponse.json({ success: false, error: 'Failed to save workspace file' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Write the revisions and restore routes**

Create `apps/mission-control/app/api/files/[slug]/revisions/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@chatbot/shared';
import { WorkspaceFileService, isWorkspaceSlug } from '@chatbot/claw-studio';
import { resolveClawForSession } from '@/lib/claw-resolver';

const logger = createLogger('mission-control:api:files:revisions');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    if (!isWorkspaceSlug(slug)) {
      return NextResponse.json({ success: false, error: 'Unknown workspace file' }, { status: 404 });
    }
    const { tenantId, clawId } = await resolveClawForSession();
    const revisions = await new WorkspaceFileService(tenantId, clawId).revisions(slug);
    return NextResponse.json({ success: true, data: revisions });
  } catch (error) {
    logger.error({ error, slug }, 'GET revisions failed');
    return NextResponse.json({ success: false, error: 'Failed to load revisions' }, { status: 500 });
  }
}
```

Create `apps/mission-control/app/api/files/[slug]/revisions/[version]/restore/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { WorkspaceFileService, isWorkspaceSlug } from '@chatbot/claw-studio';
import { resolveClawForSession } from '@/lib/claw-resolver';

const logger = createLogger('mission-control:api:files:restore');

const paramsSchema = z.object({ version: z.coerce.number().int().positive() });

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; version: string }> },
) {
  const { slug, version } = await params;
  try {
    if (!isWorkspaceSlug(slug)) {
      return NextResponse.json({ success: false, error: 'Unknown workspace file' }, { status: 404 });
    }
    const parsed = paramsSchema.safeParse({ version });
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid version' }, { status: 400 });
    }
    const { tenantId, clawId } = await resolveClawForSession();
    const file = await new WorkspaceFileService(tenantId, clawId).restore(slug, parsed.data.version);
    logger.info({ tenantId, clawId, slug, restored: parsed.data.version, version: file.version }, 'Restored workspace file');
    return NextResponse.json({ success: true, data: file });
  } catch (error) {
    logger.error({ error, slug, version }, 'POST restore failed');
    return NextResponse.json({ success: false, error: 'Failed to restore revision' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Typecheck the app**

Run:
```bash
cd apps/mission-control && bunx tsc --noEmit
```
Expected: PASS. If `@chatbot/claw-studio` subpath resolution errors, confirm the new exports were added to `libs/claw-studio/src/index.ts` in Task 7.

- [ ] **Step 5: Commit**

```bash
git add apps/mission-control/lib/claw-resolver.ts apps/mission-control/app/api/files
git commit -m "feat(mission-control): add workspace files API routes"
```

---

### Task 9: The `/agent` Files editor page

**Files:**
- Create: `apps/mission-control/hooks/use-workspace-files.ts`
- Create: `apps/mission-control/components/agent/workspace-files-client.tsx`
- Create: `apps/mission-control/components/agent/file-editor.tsx`
- Create: `apps/mission-control/components/agent/revision-history-dialog.tsx`
- Create: `apps/mission-control/app/(console)/agent/page.tsx`
- Modify: `apps/mission-control/lib/nav-config.ts`

**Interfaces:**
- Consumes: the four API routes from Task 8
- Produces: a `/agent` page rendering a `Tabs` strip over the six slugs, a `Textarea` editor per slug with a char counter, Save / Reset / History actions, and a revision dialog with restore.

Read `apps/mission-control/components/skills/skills-client.tsx` and `hooks/use-skills.ts` first — mirror their TanStack Query + `sonner` toast + shadcn `Form` conventions exactly rather than inventing new ones.

- [ ] **Step 1: Add the data hook**

Create `apps/mission-control/hooks/use-workspace-files.ts` following `hooks/use-skills.ts`:

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface WorkspaceFileDTO {
  slug: string;
  content: string;
  version: number;
  updatedBy: string;
  updatedAt: string;
  label: { title: string; blurb: string };
  charCap: number;
}

export interface RevisionDTO {
  version: number;
  updatedBy: string;
  reason: string | null;
  createdAt: string;
}

const KEY = ['workspace-files'];

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok || !body.success) throw new Error(body.error ?? 'Request failed');
  return body.data as T;
}

export function useWorkspaceFiles() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => fetch('/api/files').then((r) => unwrap<WorkspaceFileDTO[]>(r)),
  });
}

export function useSaveWorkspaceFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, content }: { slug: string; content: string }) =>
      fetch(`/api/files/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }).then((r) => unwrap<WorkspaceFileDTO>(r)),
    onSuccess: (file) => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success('Saved', { description: `${file.slug} is now v${file.version}` });
    },
    onError: (e: Error) => toast.error('Save failed', { description: e.message || 'Try again' }),
  });
}

export function useRevisions(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, slug, 'revisions'],
    enabled,
    queryFn: () => fetch(`/api/files/${slug}/revisions`).then((r) => unwrap<RevisionDTO[]>(r)),
  });
}

export function useRestoreRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, version }: { slug: string; version: number }) =>
      fetch(`/api/files/${slug}/revisions/${version}/restore`, { method: 'POST' })
        .then((r) => unwrap<WorkspaceFileDTO>(r)),
    onSuccess: (file) => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success('Restored', { description: `${file.slug} is now v${file.version}` });
    },
    onError: (e: Error) => toast.error('Restore failed', { description: e.message || 'Try again' }),
  });
}
```

- [ ] **Step 2: Build the editor and history components**

Create `apps/mission-control/components/agent/file-editor.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { type WorkspaceFileDTO, useSaveWorkspaceFile } from '@/hooks/use-workspace-files';

export function FileEditor({ file, onHistory }: { file: WorkspaceFileDTO; onHistory: () => void }) {
  const [draft, setDraft] = useState(file.content);
  const save = useSaveWorkspaceFile();

  useEffect(() => setDraft(file.content), [file.slug, file.version, file.content]);

  const dirty = draft !== file.content;
  const overCap = draft.length > file.charCap;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{file.label.blurb}</p>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={22}
        className="font-mono text-sm"
        aria-label={`${file.label.title} content`}
      />
      <div className="flex items-center justify-between">
        <span className={overCap ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
          {draft.length} / {file.charCap} characters
          {' · '}v{file.version} · last edited by {file.updatedBy}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onHistory}>History</Button>
          <Button variant="outline" disabled={!dirty} onClick={() => setDraft(file.content)}>Reset</Button>
          <Button
            disabled={!dirty || overCap || save.isPending}
            onClick={() => save.mutate({ slug: file.slug, content: draft })}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

Create `apps/mission-control/components/agent/revision-history-dialog.tsx`:

```tsx
'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useRestoreRevision, useRevisions } from '@/hooks/use-workspace-files';

export function RevisionHistoryDialog({
  slug, open, onOpenChange,
}: { slug: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data, isLoading } = useRevisions(slug, open);
  const restore = useRestoreRevision();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>History — {slug}</DialogTitle>
          <DialogDescription>
            Every edit, by you or by Claw. Restoring writes the old content as a new version.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">No revisions yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>When</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.version}>
                  <TableCell>v{r.version}</TableCell>
                  <TableCell>{r.updatedBy}</TableCell>
                  <TableCell className="max-w-xs truncate">{r.reason ?? '—'}</TableCell>
                  <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={restore.isPending}
                      onClick={() => restore.mutate({ slug, version: r.version })}
                    >
                      Restore
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Build the page and add nav**

Create `apps/mission-control/components/agent/workspace-files-client.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkspaceFiles } from '@/hooks/use-workspace-files';
import { FileEditor } from './file-editor';
import { RevisionHistoryDialog } from './revision-history-dialog';

export function WorkspaceFilesClient() {
  const { data, isLoading } = useWorkspaceFiles();
  const [historySlug, setHistorySlug] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (!data?.length) return <p className="text-sm text-muted-foreground">No workspace files.</p>;

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (!data?.length) return <p className="text-sm text-muted-foreground">No workspace files.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Agent</h1>
          <p className="text-sm text-muted-foreground">
            Who Claw is, how it works, and what it knows about you.
          </p>
        </div>
      </div>

      <Tabs defaultValue={data[0].slug}>
        <TabsList>
          {data.map((f) => (
            <TabsTrigger key={f.slug} value={f.slug}>{f.label.title}</TabsTrigger>
          ))}
        </TabsList>
        {data.map((f) => (
          <TabsContent key={f.slug} value={f.slug}>
            <Card>
              <CardContent className="pt-6">
                <FileEditor file={f} onHistory={() => setHistorySlug(f.slug)} />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <RevisionHistoryDialog
        slug={historySlug ?? ''}
        open={historySlug !== null}
        onOpenChange={(v) => !v && setHistorySlug(null)}
      />
    </div>
  );
}
```

Delete the earlier duplicated `isLoading` / empty guards if you pasted them above the return — there
should be exactly one of each.

Create `apps/mission-control/app/(console)/agent/page.tsx`. Per the UI conventions above, the page
file is thin and carries **no heading** — it matches `app/(console)/skills/page.tsx` byte for byte
except for the component name:

```tsx
import { WorkspaceFilesClient } from '@/components/agent/workspace-files-client';

export default function AgentPage() {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <WorkspaceFilesClient />
    </div>
  );
}
```

In `apps/mission-control/lib/nav-config.ts`, add `UserCog` to the `lucide-react` import and add this entry to `topNav`, after `Chat with Claw`:

```ts
  { name: 'Agent', href: '/agent', icon: UserCog, enabled: true },
```

- [ ] **Step 4: Verify in the running app**

Run the app, then:
1. Open `/agent` — six tabs render, `Soul` shows the seeded template.
2. Edit `Soul`, Save — toast reads `Saved soul (v2)`.
3. Click `History` — v2 and v1 listed; Restore v1 → toast `Restored soul to v3`, editor shows the original text.
4. Open `/chat`, ask Claw "describe your personality in one line" — the reply should reflect the edited soul, not the generic assistant text.

Also run:
```bash
cd apps/mission-control && bunx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mission-control/hooks/use-workspace-files.ts apps/mission-control/components/agent apps/mission-control/app/\(console\)/agent apps/mission-control/lib/nav-config.ts
git commit -m "feat(mission-control): add /agent workspace files editor"
```

---

### Task 10: Non-regression verification and module docs

**Files:**
- Modify: `libs/claw-studio/CLAUDE.md` (add a Workspace Files section)
- Test: `libs/claw-studio/src/agent/prompt-composer.test.ts` (add the regression pin)

**Interfaces:**
- Consumes: everything above
- Produces: a documented, verified non-regression guarantee

- [ ] **Step 1: Write the regression pin test**

Append to `libs/claw-studio/src/agent/prompt-composer.test.ts`:

```ts
describe('non-regression guarantee (spec §7.4)', () => {
  it('composes nothing for a tenant with no workspace files, on every surface', () => {
    const empty = new Map();
    expect(composeIdentity({ files: empty, surface: 'speaking' })).toBe('');
    expect(composeIdentity({ files: empty, surface: 'acting' })).toBe('');
    expect(composeIdentity({ files: empty, surface: 'scheduled' })).toBe('');
  });
});
```

An empty compose plus Task 4's `DEFAULT_IDENTITY` fallback is what makes a fileless tenant byte-identical to pre-change behaviour.

- [ ] **Step 2: Run the full verification gate**

Run:
```bash
cd libs/claw-studio && bunx vitest run && bunx tsc --noEmit -p tsconfig.json
cd ../.. && bun run test
```
Expected: all PASS with no new failures versus the baseline recorded before Task 1. Known-red `e2e:smoke` marketing/docs specs are pre-existing and out of scope.

- [ ] **Step 3: Document the module**

Add to `libs/claw-studio/CLAUDE.md`:

```markdown
## Workspace Files (soul & identity)

Claw's persona lives in six DB-backed files — `identity`, `soul`, `agents`, `user`, `tools`,
`heartbeat` — modelled on OpenClaw's `SOUL.md` / `AGENTS.md` / etc. Rows, not files: this is a
hosted multi-tenant app with no per-tenant volume.

- `workspace/types.ts` — slugs, per-file char caps, UI labels
- `workspace/templates.ts` — seed content, written to be edited
- `workspace/workspace-file-service.ts` — CRUD, idempotent seeding, revisions, restore
- `agent/prompt-composer.ts` — pure: file map + surface → prompt string

**Surfaces** decide which files reach which node. `speaking` (planner, final) gets identity/soul/
agents/user. `acting` (generate, revise) adds `tools`. `scheduled` adds `heartbeat`. The `evaluator`
and `reflect` nodes are internal classifiers and get no persona — injecting one skews classification.

**Non-regression:** a tenant with no files composes to `''`, and `buildBaseIdentity` falls back to
`DEFAULT_IDENTITY` — the exact pre-change string. Pinned by tests in `prompt-composer.test.ts` and
`prompt-templates.test.ts`. Do not change `DEFAULT_IDENTITY`.

**Historical note:** `deps.systemPrompt` used to be destructured and then shadowed by a local
`systemPrompt` in every node, so `Claw.systemPrompt` and Playground overrides were dead code. It is
now consumed as the composer's `agentsOverride`.
```

- [ ] **Step 4: Verify the docs match reality**

Re-read the section against the implemented files. Confirm every path and every exported name it
mentions exists.

- [ ] **Step 5: Commit**

```bash
git add libs/claw-studio/CLAUDE.md libs/claw-studio/src/agent/prompt-composer.test.ts
git commit -m "docs(claw-studio): document workspace files; pin non-regression behaviour"
```

---

## Verification checklist

- [ ] `cd libs/claw-studio && bunx vitest run` — green, no new failures vs baseline
- [ ] `cd libs/claw-studio && bunx tsc --noEmit -p tsconfig.json` — clean
- [ ] `cd apps/mission-control && bunx tsc --noEmit` — clean
- [ ] `bun run test` — no new failures
- [ ] `/agent` page: six tabs, edit + save + history + restore all work
- [ ] **Visual parity:** open `/skills` and `/agent` side by side. Heading size/weight, vertical
      rhythm, card padding, button sizing, and toast style must be indistinguishable. If `/agent`
      looks different, it is wrong — re-read the UI Conventions section
- [ ] `/chat`: an edited soul visibly changes Claw's voice
- [ ] `/playground`: a system-prompt override now takes effect (it previously did not)
- [ ] A tenant with no `ClawFile` rows behaves exactly as before
- [ ] No files under `integrations/`, `connectors/`, `gateway/`, `memory/`, `skills/`, `mcp/` modified —
      confirm with `git diff --stat main...HEAD -- libs/claw-studio/src`

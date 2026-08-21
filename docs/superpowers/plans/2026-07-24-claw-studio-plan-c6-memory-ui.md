# Claw Studio — Plan C6: Memory Runtimes UI (clone of nucleus's Memory page)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the tenant visibility into what Claw has actually learned — a **Memory Runtimes** page in Mission Control (replacing its "coming soon" stub) listing every long-term `ClawMemory` record (SEMANTIC facts, EPISODIC run summaries, PROCEDURAL rules), with search, kind filtering, a detail view, delete, markdown/zip export, and — the one genuinely new wiring this plan adds — a **"Promote to skill"** action for PROCEDURAL rows, finally consuming the `buildSkillDraftFromMemory`/`SkillFormDialog.initialDraft` groundwork Plan C4 shipped ahead of schedule specifically for this page.

**Architecture:** A faithful clone of nucleus's `components/memory/*` + `app/api/agent-memories/*` + `lib/queries/agent-memories.ts` + `lib/memory-export.ts`, bridged onto Claw Studio's **existing** memory data layer (`ClawMemory` / `MemoryService`, fully built in Plan C2 — no new Prisma model, no new storage). The only new backend code is two methods added to the existing `MemoryService` (`listMemories`, `deleteMemory`) — everything else (recall, remember, reconcile, working memory) is untouched.

**Key bridge — `category` does not exist here.** Nucleus's `AgentMemoryRecord` carries a business-domain `category` ('infra'|'user'|'patterns'|'errors'|'other') **in addition to** its architectural `kind` (SEMANTIC/EPISODIC/PROCEDURAL) — Claw Studio's `ClawMemory` model has only `kind`, no `category` (Plan C2 never introduced one; nucleus's `category` is a nucleus-specific ops-domain classification with no Claw Studio analog). This plan replaces every `category`-based facet (the faceted filter, the detail-dialog badge, the export table's Category row) with **`kind`** instead — the filter axis Claw Studio actually has.

**Also bridged:** nucleus's `fact`/`source`/`confidence` are top-level DTO columns the repository flattens out of the JSON `value` column for convenience — Claw Studio's `SemanticValue`/`EpisodicValue`/`ProceduralValue` types (Plan C2) keep these fields *inside* `value` only, and only `SemanticValue` and `ProceduralValue` have a `confidence` field at all (`EpisodicValue` has neither `source` nor `confidence` — it has `context`/`reasoning`/`action`/`outcome`). This plan's `MemoryRow` DTO therefore has no top-level `fact`/`source`/`confidence` columns; the list view derives a kind-aware one-line **summary** (SEMANTIC → `value.fact`, EPISODIC → `value.outcome`, PROCEDURAL → `value.instruction`) and the detail dialog/export renderer read every field straight from `value`, exactly like nucleus's own `renderValueBody` already does internally.

**Tech Stack additions:** None new. `jszip` (zip export) and `@tanstack/react-table` are already in `apps/mission-control/package.json` from Plan C4. Two new shadcn primitives are copied from `apps/web-ui/components/ui/` (`alert-dialog.tsx` — already `@base-ui/react`-based like `dialog.tsx`/`dropdown-menu.tsx`, so no new package). No `DataTableFacetedFilter` component is ported (see Global Constraints) and no `use-debounce` file exists anywhere in chatflow to copy — both are written fresh, small and self-contained.

## Global Constraints

- **Read the CURRENT nucleus source** before writing any adapted file: `components/memory/{memory-client-component,memory-detail-dialog,delete-memory-dialog}.tsx`, `app/api/agent-memories/{route,[id]/route}.ts`, `lib/queries/agent-memories.ts`, `lib/memory-export.ts`, `lib/db/repositories/agent-memory/interface.ts` — this plan's code is a faithful, well-researched starting point, not a substitute.
- **No new Prisma model, no new migration.** Storage is the existing `ClawMemory` table (`@@map("claw_memories")`); this plan only adds two read/delete methods to the existing `MemoryService` class in `libs/claw-studio/src/memory/memory-service.ts`.
- **`kind` replaces `category` everywhere** (see above) — the faceted filter, detail dialog, and export table all filter/display by `kind`, not a `category` Claw Studio doesn't have.
- **No `DataTableFacetedFilter` component.** Nucleus's version isn't present anywhere in chatflow (checked `apps/web-ui/components/ui/` — it doesn't exist there either, it's nucleus-only). Since `kind` only ever has 3 fixed values, the filter is a small `DropdownMenu` + `DropdownMenuCheckboxItem` multi-select built from primitives already copied in Plan C4/C5 — not a new generic component.
- **Client-side pagination, server-side search/filter** — matching the precedent Plan C4 (Skills) and Plan C5 (MCP servers) already set: fetch a capped page (`limit=500`) with `search`/`kind` applied server-side, then let the existing `DataTable` component's built-in client-side pagination handle display. The shared `data-table.tsx` component is **not** extended with `manualPagination`/`manualSorting` — that would be new scope beyond what Skills/MCP needed, and 500 rows is generous headroom for a 90-day TTL memory store. If a tenant's memory count exceeds it, `total` (returned by the API) will disagree with the fetched row count — surfaced via the same truncation-toast pattern the export flow already uses (Plan C4's skills export precedent), not silently.
- **Delete confirmation uses the new `AlertDialog` primitive**, not a native `confirm()` — the native dialog caused real automation/verification friction in Plan C4/C5 (browser tool couldn't drive it reliably). This plan's own delete flow ships with the more testable pattern; retrofitting Skills'/MCP servers' existing `confirm()` calls is explicitly out of scope (a separate, later cleanup if wanted).
- **"Promote to skill" only appears for `kind === 'PROCEDURAL'`** rows, exactly matching nucleus's own conditional, and reuses `buildSkillDraftFromMemory` (`libs/claw-studio/src/skills/promote.ts`, already shipped) and `SkillFormDialog`'s existing `initialDraft`/`sourceRunId` props (already shipped) — no changes needed to either file.
- **Read-only + delete only** — no create/edit API for memories (matches nucleus: memories are agent-authored, never hand-authored through this UI).
- **Standards:** typed params (no implicit `any`); try/catch + Pino (`createLogger`) in every route/service touch point; Zod for query-param parsing at the API boundary (kind allowlist, pagination bounds); shadcn/ui components only in the UI; Studio-session auth (`getServerSession(authOptions)` + `session.studio.tenantId`) instead of nucleus's RBAC `authorize()`, matching every prior Claw Studio API route.

---

### Task 1: `MemoryService.listMemories` + `MemoryService.deleteMemory`

**Files:**
- Modify: `libs/claw-studio/src/memory/memory-service.ts`
- Modify: `libs/claw-studio/src/memory/memory-service.test.ts` (or create if not already covering this class)
- Modify: `libs/claw-studio/src/index.ts` (export new types)

**Interfaces:**
```ts
export interface ListMemoriesParams {
  tenantId: string;
  kinds?: MemoryKind[];
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: 'key' | 'createdAt' | 'updatedAt' | 'expiresAt';
  sortDir?: 'asc' | 'desc';
}
export interface MemoryListRow {
  id: string; tenantId: string; userId: string; namespace: string; key: string;
  value: Record<string, unknown>; kind: MemoryKind; sourceThreadId: string | null;
  createdAt: Date; updatedAt: Date; expiresAt: Date;
  supersededById: string | null; supersededAt: Date | null;
}
export interface MemoryListPage { memories: MemoryListRow[]; total: number; }
```
`MemoryService.listMemories(p: ListMemoriesParams): Promise<MemoryListPage>` and `MemoryService.deleteMemory(tenantId: string, id: string): Promise<void>` (hard delete via `prisma.clawMemory.delete` — distinct from the existing `supersede()`, which only marks a row superseded and is used by the agent's own reconcile logic, not by a human pruning the list).

- [ ] **Step 1:** Read nucleus's `lib/db/repositories/agent-memory/postgres.ts` (143 lines) to confirm the exact `listByTenant` SQL shape (search matches `key` and the JSON `value->>'fact'`; sort defaults to `updatedAt desc`) before adapting.

- [ ] **Step 2: Write the failing test** in `libs/claw-studio/src/memory/memory-service.test.ts` (append if the file already has other `MemoryService` coverage; check first):

```ts
describe('MemoryService.listMemories / deleteMemory', () => {
  const db = getPrismaClient();
  const suffix = Date.now().toString(36);
  const TENANT_ID = `test-tenant-memory-list-${suffix}`;

  beforeAll(async () => {
    await db.clawMemory.createMany({
      data: [
        { tenantId: TENANT_ID, userId: 'claw-1', namespace: 'billing', key: 'invoice-format', value: { fact: 'Invoices use net-30 terms', source: 'user', confidence: 'high' }, kind: 'SEMANTIC', expiresAt: new Date(Date.now() + 86_400_000) },
        { tenantId: TENANT_ID, userId: 'claw-1', namespace: 'ops', key: 'paginate-lists', value: { instruction: 'Always paginate', trigger: 'list operations', evidence: 'missed rows once' }, kind: 'PROCEDURAL', expiresAt: new Date(Date.now() + 86_400_000) },
      ],
    });
  });
  afterAll(async () => {
    await db.clawMemory.deleteMany({ where: { tenantId: TENANT_ID } });
  });

  it('lists memories for a tenant, newest-updated first by default', async () => {
    const service = getMemoryService();
    const { memories, total } = await service.listMemories({ tenantId: TENANT_ID });
    expect(total).toBe(2);
    expect(memories).toHaveLength(2);
  });

  it('filters by kind', async () => {
    const service = getMemoryService();
    const { memories, total } = await service.listMemories({ tenantId: TENANT_ID, kinds: ['PROCEDURAL'] });
    expect(total).toBe(1);
    expect(memories[0].kind).toBe('PROCEDURAL');
  });

  it('searches key and value->>fact', async () => {
    const service = getMemoryService();
    const { memories } = await service.listMemories({ tenantId: TENANT_ID, search: 'net-30' });
    expect(memories).toHaveLength(1);
    expect(memories[0].key).toBe('invoice-format');
  });

  it('deleteMemory hard-deletes the row', async () => {
    const service = getMemoryService();
    const { memories } = await service.listMemories({ tenantId: TENANT_ID, kinds: ['SEMANTIC'] });
    await service.deleteMemory(TENANT_ID, memories[0].id);
    const after = await db.clawMemory.findUnique({ where: { id: memories[0].id } });
    expect(after).toBeNull();
  });
});
```

- [ ] **Step 3: Implement**, appending to the `MemoryService` class:

```ts
async listMemories(p: ListMemoriesParams): Promise<MemoryListPage> {
    const prisma = getPrismaClient();
    const page = p.page ?? 1;
    const limit = p.limit ?? 100;
    const sortBy = p.sortBy ?? 'updatedAt';
    const sortDir = p.sortDir ?? 'desc';
    const kindList = p.kinds?.length ? p.kinds : null;
    const searchTerm = p.search?.trim() ? `%${p.search.trim()}%` : null;

    const whereFragment = Prisma.sql`
      "tenantId" = ${p.tenantId}
      AND (${kindList}::text[] IS NULL OR "kind"::text = ANY(${kindList}::text[]))
      AND (${searchTerm}::text IS NULL OR "key" ILIKE ${searchTerm} OR ("value"->>'fact') ILIKE ${searchTerm} OR ("value"->>'instruction') ILIKE ${searchTerm})
    `;
    const orderColumn = Prisma.raw(`"${sortBy}"`);
    const orderDir = Prisma.raw(sortDir === 'asc' ? 'ASC' : 'DESC');

    const [memories, totalRows] = await Promise.all([
        prisma.$queryRaw<MemoryListRow[]>(Prisma.sql`
          SELECT "id","tenantId","userId","namespace","key","value","kind","sourceThreadId","createdAt","updatedAt","expiresAt","supersededById","supersededAt"
          FROM claw_memories
          WHERE ${whereFragment}
          ORDER BY ${orderColumn} ${orderDir}
          LIMIT ${limit} OFFSET ${(page - 1) * limit}
        `),
        prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT COUNT(*)::bigint AS count FROM claw_memories WHERE ${whereFragment}
        `),
    ]);
    return { memories, total: Number(totalRows[0]?.count ?? 0) };
}

async deleteMemory(tenantId: string, id: string): Promise<void> {
    const prisma = getPrismaClient();
    await prisma.clawMemory.deleteMany({ where: { id, tenantId } });
}
```

Note: `orderColumn`/`orderDir` are built with `Prisma.raw` from a **fixed allowlist** validated at the API boundary (Task 2's Zod schema), never from unsanitized user input directly — the service itself does not re-validate `sortBy` against the allowlist, matching the trust boundary already established for other Claw Studio services (validation happens once, at the API route).

- [ ] **Step 4:** Export `ListMemoriesParams`, `MemoryListRow`, `MemoryListPage` types from `libs/claw-studio/src/index.ts` alongside the existing `MemoryService`/`getMemoryService` export line.

- [ ] **Step 5: Run** `bunx vitest run src/memory/memory-service.test.ts` in `libs/claw-studio` → all pass.

---

### Task 2: API routes — `/api/memories`

**Files:**
- Create: `apps/mission-control/app/api/memories/route.ts` (GET list)
- Create: `apps/mission-control/app/api/memories/[id]/route.ts` (GET one, DELETE)

**Interfaces:** `GET /api/memories?kind=SEMANTIC,PROCEDURAL&search=...&sort=updatedAt&dir=desc&limit=500&page=1` → `{ success, data: MemoryListRow[], total }`. `GET /api/memories/:id` → `{ success, data: MemoryListRow }`. `DELETE /api/memories/:id` → `{ success: true }`.

- [ ] **Step 1:** `route.ts` — Zod-validate query params (kind allowlist `['SEMANTIC','EPISODIC','PROCEDURAL']`, sort allowlist `['key','createdAt','updatedAt','expiresAt']`, `limit` capped at 500, `page` >= 1), call `getMemoryService().listMemories(...)`, Studio-session auth matching `apps/mission-control/app/api/skills/route.ts`'s bridge exactly.

- [ ] **Step 2:** `[id]/route.ts` — GET fetches via a single-row `listMemories({ tenantId, search: undefined })`-then-filter is wrong (no `getById` exists yet); instead add a tiny direct lookup inline in the route: `getPrismaClient().clawMemory.findFirst({ where: { id, tenantId } })` (a raw Prisma read needs no new service method — this mirrors how `apps/mission-control/app/api/skills/[id]/route.ts` reads a single skill directly via Prisma rather than adding a dedicated service method for a single call site). DELETE calls `getMemoryService().deleteMemory(tenantId, id)` after confirming the row exists and belongs to the tenant (404 otherwise).

- [ ] **Step 3: Verify** `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json` passes.

---

### Task 3: Client hooks — `apps/mission-control/hooks/use-memories.ts`

**Files:**
- Create: `apps/mission-control/hooks/use-memories.ts`

**Interfaces:** `useMemories(filters)`, `useMemory(id)` (kept for parity with nucleus though not wired into the UI, same as nucleus's own unused-for-now note), `useDeleteMemory()`, `fetchAllMemories()` (pages through up to the same 500-row cap for export-all, with a truncation flag when `total` exceeds it).

- [ ] **Step 1:** Port `lib/queries/agent-memories.ts`'s hooks, dropping every `category`/`fact`/`source`/`confidence` reference and typing `MemoryRow` to match `MemoryListRow` (Task 1) instead of nucleus's flattened DTO.

- [ ] **Step 2: Verify** typecheck passes.

---

### Task 4: `use-debounce` hook

**Files:**
- Create: `apps/mission-control/hooks/use-debounce.ts`

- [ ] **Step 1:** Standard debounced-value hook (no file to copy from anywhere in chatflow — written fresh, ~10 lines):

```ts
import { useEffect, useState } from 'react';

export function useDebounce<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
```

---

### Task 5: `memory-export.ts`

**Files:**
- Create: `libs/claw-studio/src/memory/memory-export.ts`
- Test: `libs/claw-studio/src/memory/memory-export.test.ts`
- Modify: `libs/claw-studio/src/index.ts`

**Interfaces:** `buildMemoryMarkdown`, `buildAllMemoriesMarkdown`, `buildMemoryFile`, `exportMemoryToMarkdown`, `exportAllMemoriesToMarkdown`, `exportMemoryToFile`, `exportAllMemoriesToZip` — same shape as `skills/skill-export.ts` (Plan C4), reusing `fence`/`anchor`/`fileSafe`/`yamlScalar`/`downloadBlob`/`downloadText` from that file rather than duplicating them (they're transport/format helpers with zero skill-specific logic).

- [ ] **Step 1:** Read nucleus's `lib/memory-export.ts` (174 lines, captured verbatim above) as the reference. Note it imports `fence`... actually does not (memory bodies are prose, never fenced) — keep that same choice.

- [ ] **Step 2:** Implement, importing the shared helpers from `../skills/skill-export` and dropping every `category`/top-level `fact`/`source`/`confidence` reference — `renderValueBody` reads `value.fact`/`value.source`/`value.confidence` etc. directly instead of separate DTO columns:

```ts
import { anchor, fileSafe, yamlScalar, downloadBlob, downloadText } from '../skills/skill-export';
import type { MemoryKind } from './types';

export interface MemoryExportRow {
  id: string; namespace: string; key: string; value: Record<string, unknown>; kind: MemoryKind;
  createdAt: string; updatedAt: string; expiresAt: string; supersededById: string | null;
}

const KIND_ORDER: MemoryKind[] = ['SEMANTIC', 'EPISODIC', 'PROCEDURAL'];

function field(value: Record<string, unknown>, key: string): string {
  const v = value?.[key];
  return typeof v === 'string' && v.length ? v : '—';
}

function renderValueBody(memory: MemoryExportRow): string {
  const v = memory.value ?? {};
  switch (memory.kind) {
    case 'SEMANTIC':
      return [`**Fact:** ${field(v, 'fact')}`, `**Source:** ${field(v, 'source')}`, `**Confidence:** ${field(v, 'confidence')}`, ''].join('\n');
    case 'EPISODIC':
      return [`**Context:** ${field(v, 'context')}`, `**Reasoning:** ${field(v, 'reasoning')}`, `**Action:** ${field(v, 'action')}`, `**Outcome:** ${field(v, 'outcome')}`, ''].join('\n');
    case 'PROCEDURAL':
      return [`**Instruction:** ${field(v, 'instruction')}`, `**Trigger:** ${field(v, 'trigger')}`, `**Evidence:** ${field(v, 'evidence')}`, `**Confidence:** ${field(v, 'confidence')}`, ''].join('\n');
    default:
      return '';
  }
}

export function buildMemoryMarkdown(memory: MemoryExportRow): string {
  return [
    `# ${memory.key}`, '',
    '| Field | Value |', '| --- | --- |',
    `| Kind | ${memory.kind} |`, `| Namespace | ${memory.namespace} |`,
    `| Created | ${memory.createdAt} |`, `| Updated | ${memory.updatedAt} |`,
    `| Superseded by | ${memory.supersededById ?? '—'} |`, '',
    renderValueBody(memory),
  ].join('\n');
}

export function buildAllMemoriesMarkdown(memories: MemoryExportRow[]): string {
  const header: string[] = ['# Memory export', '', `Exported ${memories.length} memory record(s).`, ''];
  if (memories.length === 0) { header.push('_No memories to export._', ''); return header.join('\n'); }
  const byKind = new Map<MemoryKind, MemoryExportRow[]>();
  for (const m of memories) { const arr = byKind.get(m.kind) ?? []; arr.push(m); byKind.set(m.kind, arr); }
  for (const arr of byKind.values()) arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  header.push('## Table of contents', '');
  for (const kind of KIND_ORDER) {
    const arr = byKind.get(kind);
    if (!arr?.length) continue;
    header.push(`### ${kind}`, '');
    for (const m of arr) header.push(`- [${m.key}](#${anchor(m.key)})`);
    header.push('');
  }
  header.push('---', '');
  const body = KIND_ORDER.flatMap((kind) => (byKind.get(kind) ?? []).map((m) => `${buildMemoryMarkdown(m)}\n---\n`));
  return `${header.join('\n')}\n${body.join('\n')}`;
}

export function buildMemoryFile(memory: MemoryExportRow): string {
  const fm = ['---', `kind: ${memory.kind}`, `namespace: ${yamlScalar(memory.namespace)}`, `key: ${yamlScalar(memory.key)}`,
    `created_at: ${memory.createdAt}`, `updated_at: ${memory.updatedAt}`, '---', ''];
  return `${fm.join('\n')}\n${renderValueBody(memory)}`;
}

export function exportMemoryToMarkdown(memory: MemoryExportRow): void {
  downloadText(buildMemoryMarkdown(memory), `memory-${fileSafe(memory.key, memory.id)}.md`);
}
export function exportAllMemoriesToMarkdown(memories: MemoryExportRow[]): void {
  downloadText(buildAllMemoriesMarkdown(memories), `memories-export-${new Date().toISOString().slice(0, 10)}.md`);
}
export function exportMemoryToFile(memory: MemoryExportRow): void {
  downloadText(buildMemoryFile(memory), `${memory.id}.md`);
}
export async function exportAllMemoriesToZip(memories: MemoryExportRow[]): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const root = zip.folder('memories');
  if (!root) throw new Error('Failed to create memories folder in zip');
  for (const kind of KIND_ORDER) for (const m of memories.filter((x) => x.kind === kind)) root.file(`${kind}/${m.id}.md`, buildMemoryFile(m));
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `memories-export-${new Date().toISOString().slice(0, 10)}.zip`);
}
```

- [ ] **Step 3:** Confirm `fence`/`anchor`/`fileSafe`/`yamlScalar`/`downloadBlob`/`downloadText` are all already exported from `libs/claw-studio/src/skills/skill-export.ts` (they are, per Plan C4) — if any is not, export it there rather than duplicating its body here.

- [ ] **Step 4: Write and run tests** mirroring `skill-export.test.ts`'s structure (one test per exported pure builder; the impure `download*`/zip functions get a lightweight DOM-mock smoke test, same pattern already used for skills).

- [ ] **Step 5:** Export the new functions + `MemoryExportRow` type from `libs/claw-studio/src/index.ts`.

---

### Task 6: Copy `alert-dialog.tsx`

**Files:**
- Create: `apps/mission-control/components/ui/alert-dialog.tsx`

- [ ] **Step 1:** Read `apps/web-ui/components/ui/alert-dialog.tsx` (188 lines, uses `@base-ui/react/alert-dialog` — already a mission-control dependency, no new package) and write it unchanged to `apps/mission-control/components/ui/alert-dialog.tsx`, per the same verbatim-copy convention Plan C4/C5 established for every other shadcn primitive.

- [ ] **Step 2: Verify** `bunx tsc --noEmit -p tsconfig.json` passes (no consumers yet).

---

### Task 7: Memory Runtimes UI

**Files:**
- Create: `apps/mission-control/components/memory/memories-client.tsx`
- Create: `apps/mission-control/components/memory/memory-detail-dialog.tsx`
- Create: `apps/mission-control/components/memory/delete-memory-dialog.tsx`
- Modify: `apps/mission-control/app/(console)/memory/page.tsx` (replace stub)
- Modify: `apps/mission-control/lib/nav-config.ts` (`Memory Runtimes` → `enabled: true`)

**Interfaces:** Same data-table + row-actions shape as `skills-client.tsx`/`mcp-servers-client.tsx` — but read-only-plus-delete (no create dialog), with a Kind multi-select filter, a search box (debounced via Task 4's hook), a detail dialog, a delete confirmation via the new `AlertDialog`, and a "Promote to skill" row action for PROCEDURAL rows that opens the **existing** `SkillFormDialog` (from `components/skills/`) with `initialDraft` pre-populated.

- [ ] **Step 1:** `delete-memory-dialog.tsx` — direct port of nucleus's, using the newly-copied `AlertDialog` primitives (verbatim structure; only the import path for `MemoryRow` changes).

- [ ] **Step 2:** `memory-detail-dialog.tsx` — port of nucleus's, with the `Category` row **removed** (no Claw Studio equivalent) and a `Kind` row added in its place (`<Badge variant="outline">{memory.kind}</Badge>`); `Fact`/`Source`/`Confidence` rows read from `memory.value.fact`/`memory.value.source`/`memory.value.confidence` (present only for SEMANTIC/PROCEDURAL — render `—` when absent) instead of nucleus's flattened top-level columns; keep the raw-JSON `<pre>` block unchanged.

- [ ] **Step 3:** `memories-client.tsx` — port of `memory-client-component.tsx` with these bridges:
  - `CATEGORY_OPTIONS`/`DataTableFacetedFilter` → a `KIND_OPTIONS = ['SEMANTIC','EPISODIC','PROCEDURAL']` array rendered via `DropdownMenu` + `DropdownMenuCheckboxItem` (one checkbox item per kind, a "Kind" trigger button showing the count selected — mirroring the compact style of `DataTableFacetedFilter` without introducing the component itself).
  - The `fact` column → a `summary` column computed by a small local `summaryForKind(row)` helper (SEMANTIC → `value.fact`, EPISODIC → `value.outcome`, PROCEDURAL → `value.instruction`, truncated the same way nucleus truncates `fact`).
  - The `confidence` column stays, reading `row.value.confidence` (render `—` for EPISODIC, which has none).
  - Drop `manualPagination`/`manualSorting`/`rowCount`/`sorting`/`onSortingChange`/`pagination`/`onPaginationChange` DataTable props (not supported by mission-control's `DataTable` — see Global Constraints) — fetch `{ limit: 500, sort: 'updatedAt', dir: 'desc', kind: ..., search: ... }` once per filter change and let `DataTable`'s own `enableSorting`/`enablePagination`/`defaultPageSize` handle the rest client-side, matching `skills-client.tsx`'s pattern exactly.
  - **Add** the "Promote to skill" `DropdownMenuItem` (conditioned on `row.kind === 'PROCEDURAL'`) that calls `buildSkillDraftFromMemory(row)` (imported from `@chatbot/claw-studio`) and opens the existing `<SkillFormDialog open onOpenChange initialDraft={draft} sourceRunId={row.sourceThreadId} />` from `components/skills/skill-form-dialog` — this is the one new capability this plan adds beyond a straight port.
  - Export-all menu (Markdown / zip) ports directly, calling the Task 5 functions instead of nucleus's `lib/memory-export`.
  - Page header: `"Memory"` title stays but description becomes `"What Claw has learned across sessions. Review and prune as needed."` (drop "AI Ops agent" nucleus-specific wording).

- [ ] **Step 4:** Replace `apps/mission-control/app/(console)/memory/page.tsx`'s stub with `<MemoriesClient />`, matching `skills/page.tsx`'s shape.

- [ ] **Step 5:** Flip `{ name: 'Memory Runtimes', href: '/memory', icon: Brain, enabled: false }` → `enabled: true` in `lib/nav-config.ts`.

- [ ] **Step 6: Verify** `bunx tsc --noEmit -p tsconfig.json` and `bunx nx build mission-control` both pass.

---

### Task 8: Full verification

- [ ] Run `bunx vitest run` in `libs/claw-studio` → all tests (including the new `memory-service.test.ts` additions and `memory-export.test.ts`) pass.
- [ ] `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json` and `bunx nx build mission-control` both clean.
- [ ] Live browser check: seed a few real `ClawMemory` rows (one per kind, including a PROCEDURAL one) directly via Prisma for a disposable test tenant (matching the pattern used for Plan C5's live check), open `/memory`, confirm the table renders with kind badges and summaries, search and Kind-filter narrow the results, the detail dialog shows the raw JSON, **Promote to skill** on the PROCEDURAL row opens the skill form pre-filled with the expected name/description/content, delete removes a row via the new `AlertDialog` (confirm it's actually reliably drivable, unlike the earlier native-`confirm()` friction), and export-all downloads without crashing. Clean up the seeded rows and any disposable tenant afterward.

---

**Standing reminder:** per the user's explicit instruction, do not commit any of this work unless told to — keep everything staged/uncommitted, same as Plans C4 and C5.

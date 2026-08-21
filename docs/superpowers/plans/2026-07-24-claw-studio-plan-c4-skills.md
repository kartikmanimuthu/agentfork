# Claw Studio — Plan C4: Skills (clone of nucleus's Skill subsystem)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Claw real, persistent skills — a `ClawSkill` model, the autonomous skill-synthesis engine that turns matured procedural memory into new system skills (un-stubbing Plan C2's `synthesizeDomainSkills` no-op), progressive-disclosure skill loading in the executor graph (catalog in the evaluator/generate prompts, full content via a `load_skill` tool), and a real **Skills Runtimes** management page in Mission Control replacing its "coming soon" stub.

**Architecture:** A faithful clone of nucleus's `Skill` subsystem (`lib/skill-service.ts`, `lib/agent/memory/skill-synthesis.ts`, `lib/agent/skill-tool.ts`, `lib/skill-export.ts`, the `app/api/skills/*` routes, and `components/skills/*`). Bridges (documented per-task): nucleus's layered repository abstraction (`ISkillRepository`/`getSkillRepository()`) is flattened to direct Prisma calls via `getPrismaClient()`, matching every other Claw Studio service; nucleus's `agent_memories` raw SQL becomes `claw_memories` and gains an explicit `userId` (`=claw.id`) filter, matching the `(tenantId, userId)` dual-scoping convention Plan C2 already established; Mission Control's Studio session (no user/role system) replaces nucleus's `authorize()`/RBAC calls with a plain authenticated-session check, matching `/api/chat`'s existing pattern; the two skills API routes gain Zod validation at the boundary (nucleus's own routes do bare truthy checks only — a gap this port corrects, not copies, per this repo's mandatory standards).

One important **correction to how skill selection actually works**: nucleus's `auto-skill-select.ts` (a separate reflector-model call) is used only by the *other* AI-Ops chat agents (`fast-agent.ts`/`planning-agent.ts`) — **not** by Agent Ops' `executor-graphs.ts`, which the Claw graph mirrors. Agent Ops' own `evaluatorNode` selects the skill **inline**, as part of its single JSON-returning LLM call, by injecting the skill catalog into that same prompt. This plan wires skill selection the way Agent Ops actually does it (extending the evaluator prompt already built in Plan C3) — porting `auto-skill-select.ts` as a separate module would be porting code Claw's own reference graph doesn't use.

**Tech Stack additions:** `@monaco-editor/react` (skill content editor), `react-hook-form` + `@hookform/resolvers` (form validation), `react-markdown` + `remark-gfm` (skill preview rendering), `jszip` (bulk SKILL.md export), `@tanstack/react-table` (skills data table) — all added to `apps/mission-control/package.json` only (never web-ui, matching the existing dependency-isolation rule).

## Global Constraints

- **Read the CURRENT nucleus source** for every ported file before writing the adapted version (`lib/skill-service.ts`, `lib/agent/memory/skill-synthesis.ts`, `lib/agent/skill-tool.ts`, `lib/skill-export.ts`, `lib/export-utils.ts`, `app/api/skills/{route,[id]/route,distill/route}.ts`, `components/skills/{skills-client,skill-form-dialog,skill-detail-dialog}.tsx`, `components/ui/{form,markdown-content}.tsx`) — this plan's code is a faithful, well-researched starting point, not a substitute.
- **Bridges (the only intended changes):** direct Prisma (`db.clawSkill`) instead of a repository abstraction layer; `claw_memories` table + explicit `userId` filter instead of `agent_memories`; Studio-session auth instead of RBAC `authorize()`; Zod validation added at both skills API routes (correcting nucleus's gap); table name `@@map("claw_skills")`.
- **No Accounts/Knowledge-Base fields anywhere** — Claw Studio has neither concept (matches Plan C3).
- **Skill selection is inline in the evaluator**, not a separate `auto-skill-select.ts` module (see the correction above) — do not port that file as a standalone piece.
- **Standards:** typed params (no implicit `any`); try/catch + Pino (`createLogger`) in every route/service/graph-node touch point; Zod at both new API route boundaries; shadcn/ui components only in the UI; fail-open behavior preserved everywhere nucleus has it (synthesis failures never throw, catalog-fetch failures degrade to "no skills").
- **Dependency isolation:** `@monaco-editor/react`, `react-hook-form`, `@hookform/resolvers`, `react-markdown`, `remark-gfm`, `jszip`, `@tanstack/react-table` go in `apps/mission-control/package.json` only.
- **Prisma conventions:** `cuid()` ids, camelCase fields, `@@map` snake_case table name, `@@index([tenantId])`, `@@unique([tenantId, slug])` — no relation to `Tenant`/`Claw` (scalar `tenantId` only), matching the precedent Plan C2 already set for `ClawMemory`/`ClawWorkingMemory` (app-enforced scoping, not a DB relation).

---

### Task 1: Prisma `ClawSkill` model + migration

**Files:**
- Modify: `prisma/schema.prisma` (add `ClawSkill` model)
- Create: the migration (`bunx prisma migrate dev --name add_claw_skill`)

**Interfaces:** Produces `db.clawSkill` Prisma delegate with fields `{id, tenantId, slug, name, description, tier, content, source, isEnabled, createdBy, sourceRunId, createdAt, updatedAt}`, unique on `(tenantId, slug)`.

- [ ] **Step 1:** Read the `Skill` model in nucleus's `libs/prisma/schema.prisma` (already captured verbatim in this plan's research — reproduced below) to confirm it hasn't changed.

- [ ] **Step 2:** Append to `prisma/schema.prisma`:

```prisma
model ClawSkill {
  id          String   @id @default(cuid())
  tenantId    String
  slug        String
  name        String
  description String
  tier        String   // 'read-only' | 'mutation' | 'approval-gated'
  content     String   @db.Text
  source      String   @default("user") // 'user' | 'system'
  isEnabled   Boolean  @default(true)
  createdBy   String?
  sourceRunId String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([tenantId, slug])
  @@index([tenantId])
  @@map("claw_skills")
}
```

- [ ] **Step 3:** Validate + migrate.

Run: `bunx prisma validate --schema=./prisma/schema.prisma` → valid.
Run: `bunx prisma migrate dev --name add_claw_skill --schema=./prisma/schema.prisma` → migration created + applied + client regenerated.

- [ ] **Step 4: Verify** the delegate exists:

Run: `node -e "const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); console.log(!!p.clawSkill)"` → `true`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(claw-studio): add ClawSkill model"
```

---

### Task 2: Skill service — `libs/claw-studio/src/skills/skill-service.ts`

**Files:**
- Create: `libs/claw-studio/src/skills/skill-service.ts`
- Test: `libs/claw-studio/src/skills/skill-service.test.ts`
- Modify: `libs/claw-studio/src/index.ts`

**Interfaces:**
- Produces: `slugify(name)`, `loadSkills(tenantId)`, `getSkillById(tenantId, slug)`, `getSkillContent(tenantId, slug)`, `loadAllSkillContent(tenantId)`, `getSkillSummaries(tenantId)` — same signatures as nucleus, backed by direct Prisma instead of a repository abstraction.

- [ ] **Step 1:** Read nucleus's `apps/web-ui/lib/skill-service.ts` (44 lines) and `apps/web-ui/lib/db/repositories/skill/interface.ts` (the `SkillTier`/`SkillRecord` types the port's return shapes must match).

- [ ] **Step 2: Write the failing test**

Create `libs/claw-studio/src/skills/skill-service.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '@chatbot/shared';
import { slugify, loadSkills, getSkillById, getSkillContent, loadAllSkillContent, getSkillSummaries } from './skill-service';

const db = getPrismaClient();
const suffix = Date.now().toString(36);
const TENANT_ID = `test-tenant-skill-service-${suffix}`;

beforeAll(async () => {
  await db.clawSkill.create({
    data: { tenantId: TENANT_ID, slug: 'billing-basics', name: 'Billing Basics', description: 'When asked about invoices', tier: 'read-only', content: 'Check the invoice table first.', isEnabled: true },
  });
  await db.clawSkill.create({
    data: { tenantId: TENANT_ID, slug: 'disabled-skill', name: 'Disabled Skill', description: 'Should never surface', tier: 'read-only', content: 'secret', isEnabled: false },
  });
});

afterAll(async () => {
  await db.clawSkill.deleteMany({ where: { tenantId: TENANT_ID } });
});

describe('slugify', () => {
  it('lowercases, hyphenates, and strips non-alphanumerics', () => {
    expect(slugify('Cost Analyser!')).toBe('cost-analyser');
    expect(slugify('  Multi   Word  ')).toBe('multi-word');
  });
});

describe('loadSkills', () => {
  it('returns only enabled skills for the tenant', async () => {
    const skills = await loadSkills(TENANT_ID);
    expect(skills.map((s) => s.id)).toEqual(['billing-basics']);
  });
});

describe('getSkillById / getSkillContent', () => {
  it('returns metadata and content for an enabled skill', async () => {
    expect(await getSkillById(TENANT_ID, 'billing-basics')).toMatchObject({ id: 'billing-basics', name: 'Billing Basics' });
    expect(await getSkillContent(TENANT_ID, 'billing-basics')).toBe('Check the invoice table first.');
  });

  it('returns null content for a disabled skill (veto)', async () => {
    expect(await getSkillContent(TENANT_ID, 'disabled-skill')).toBeNull();
  });
});

describe('loadAllSkillContent', () => {
  it('maps enabled skill slugs to content only', async () => {
    const map = await loadAllSkillContent(TENANT_ID);
    expect(map.get('billing-basics')).toBe('Check the invoice table first.');
    expect(map.has('disabled-skill')).toBe(false);
  });
});

describe('getSkillSummaries', () => {
  it('formats an enabled-only catalog', async () => {
    const summary = await getSkillSummaries(TENANT_ID);
    expect(summary).toContain('- billing-basics: Billing Basics - When asked about invoices');
    expect(summary).not.toContain('disabled-skill');
  });

  it('reports no skills for a tenant with none', async () => {
    expect(await getSkillSummaries('tenant-with-no-skills')).toBe('No specialized skills available.');
  });
});
```

- [ ] **Step 3: Run it → fails**

Run: `cd libs/claw-studio && bunx vitest run src/skills/skill-service.test.ts` → FAIL (module doesn't exist).

- [ ] **Step 4: Implement**

Create `libs/claw-studio/src/skills/skill-service.ts`:

```ts
/**
 * skill-service.ts — ported from nucleus lib/skill-service.ts. Nucleus reads
 * through a repository abstraction (getSkillRepository()); this port uses
 * Prisma directly (db.clawSkill), matching every other Claw Studio service.
 */

import { getPrismaClient } from '@chatbot/shared';

export type SkillTier = 'read-only' | 'mutation' | 'approval-gated';

export interface SkillMetadata {
  id: string; // == slug
  name: string;
  description: string;
  tier: SkillTier;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function loadSkills(tenantId: string): Promise<SkillMetadata[]> {
  const rows = await getPrismaClient().clawSkill.findMany({
    where: { tenantId, isEnabled: true },
    orderBy: { name: 'asc' },
  });
  return rows.map((s) => ({ id: s.slug, name: s.name, description: s.description, tier: s.tier as SkillTier }));
}

export async function getSkillById(tenantId: string, slug: string): Promise<SkillMetadata | null> {
  const s = await getPrismaClient().clawSkill.findFirst({ where: { tenantId, slug } });
  return s ? { id: s.slug, name: s.name, description: s.description, tier: s.tier as SkillTier } : null;
}

export async function getSkillContent(tenantId: string, slug: string): Promise<string | null> {
  const s = await getPrismaClient().clawSkill.findFirst({ where: { tenantId, slug } });
  return s && s.isEnabled ? s.content : null;
}

export async function loadAllSkillContent(tenantId: string): Promise<Map<string, string>> {
  const rows = await getPrismaClient().clawSkill.findMany({ where: { tenantId, isEnabled: true } });
  return new Map(rows.map((s) => [s.slug, s.content]));
}

export async function getSkillSummaries(tenantId: string): Promise<string> {
  const skills = await loadSkills(tenantId);
  if (skills.length === 0) return 'No specialized skills available.';
  const summaries = skills.map((s) => `- ${s.id}: ${s.name} - ${s.description}`).join('\n');
  return `Available Skills:\n${summaries}`;
}
```

- [ ] **Step 5: Export + run tests**

Add to `libs/claw-studio/src/index.ts`:

```ts
export {
  slugify, loadSkills, getSkillById, getSkillContent, loadAllSkillContent, getSkillSummaries,
} from './skills/skill-service';
export type { SkillTier, SkillMetadata } from './skills/skill-service';
```

Run: `cd libs/claw-studio && bunx vitest run src/skills/skill-service.test.ts` → PASS.
Run: `bunx nx typecheck claw-studio` → no errors.

- [ ] **Step 6: Commit**

```bash
git add libs/claw-studio/src
git commit -m "feat(claw-studio): skill-service ported from nucleus (direct-Prisma)"
```

---

### Task 3: Skill-synthesis — un-stub Plan C2's no-op

**Files:**
- Create: `libs/claw-studio/src/skills/skill-synthesis.ts`
- Test: `libs/claw-studio/src/skills/skill-synthesis.test.ts`
- Modify: `libs/claw-studio/src/memory/memory-nodes.ts` (replace the stub, wire the real call)
- Modify: `libs/claw-studio/src/env.ts` (three new env flags)
- Modify: `libs/claw-studio/src/index.ts`

**Interfaces:** Produces `synthesizeDomainSkills(params: { tenantId: string; userId: string; threadId?: string; distillerModel: BaseChatModel }): Promise<number>` — same contract as nucleus, with an added `userId` param (see Global Constraints) to keep the `claw_memories` query correctly scoped to this Claw.

- [ ] **Step 1:** Read nucleus's `apps/web-ui/lib/agent/memory/skill-synthesis.ts` (240 lines, already captured in full in this plan's research) in full before writing — the raw SQL, the ownership-veto guard, and the `DISTILLER_SYSTEM` prompt must be preserved exactly.

- [ ] **Step 2: Add env flags**

In `libs/claw-studio/src/env.ts`, add to `server`:

```ts
    AUTO_SKILL_CREATION_ENABLED: z.string().optional(),
    AUTO_SKILL_MATURITY_THRESHOLD: z.string().optional(),
    SKILL_SYNTHESIS_MIN_RULES: z.string().optional(),
```

(Kept as raw optional strings, parsed by the lib-local helper functions below — matching how `reconcile.ts`/`episode.ts`/`procedural.ts` already read their own flags in this lib, per Plan C2's established pattern; do not coerce here.)

- [ ] **Step 3: Write the failing test**

Create `libs/claw-studio/src/skills/skill-synthesis.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { getPrismaClient } from '@chatbot/shared';
import { synthesizeDomainSkills } from './skill-synthesis';

const db = getPrismaClient();
const suffix = Date.now().toString(36);
const TENANT_ID = `test-tenant-skill-synth-${suffix}`;
const USER_ID = `test-claw-skill-synth-${suffix}`;

async function seedMaturedRule(key: string, overrides: Record<string, unknown> = {}) {
  await db.clawMemory.create({
    data: {
      tenantId: TENANT_ID, userId: USER_ID, namespace: 'procedures/billing', key,
      kind: 'PROCEDURAL', accessCount: 5, expiresAt: new Date(Date.now() + 86_400_000),
      value: { instruction: 'Always check the invoice table first', trigger: 'any billing question', evidence: 'a support run found the answer there', confidence: 'high', ...overrides },
    },
  });
}

describe('synthesizeDomainSkills', () => {
  beforeEach(async () => {
    await db.clawSkill.deleteMany({ where: { tenantId: TENANT_ID } });
    await db.clawMemory.deleteMany({ where: { tenantId: TENANT_ID } });
    process.env.AUTO_SKILL_CREATION_ENABLED = undefined;
    process.env.SKILL_SYNTHESIS_MIN_RULES = '2';
  });

  it('does nothing when fewer than the minimum matured rules exist', async () => {
    await seedMaturedRule('rule-one');
    const model = new FakeListChatModel({ responses: ['should not be called'] });
    const created = await synthesizeDomainSkills({ tenantId: TENANT_ID, userId: USER_ID, distillerModel: model });
    expect(created).toBe(0);
  });

  it('creates a system skill once enough rules mature, with a code-appended ledger', async () => {
    await seedMaturedRule('rule-one');
    await seedMaturedRule('rule-two', { instruction: 'Escalate refunds over $500', trigger: 'a refund request', evidence: 'policy doc' });
    const distillerJson = JSON.stringify({ name: 'Billing Ops', description: 'Use for billing questions', narrative: '## Purpose\nHelp with billing.\n## When to use\nBilling questions.\n## Workflow guidance\nCheck records.\n## Safety notes\nNone.' });
    const model = new FakeListChatModel({ responses: [distillerJson] });

    const created = await synthesizeDomainSkills({ tenantId: TENANT_ID, userId: USER_ID, distillerModel: model });
    expect(created).toBe(1);

    const skill = await db.clawSkill.findFirst({ where: { tenantId: TENANT_ID, slug: 'sys-billing' } });
    expect(skill).toBeTruthy();
    expect(skill!.source).toBe('system');
    expect(skill!.tier).toBe('read-only');
    expect(skill!.isEnabled).toBe(true);
    expect(skill!.content).toContain('## Learned rules & gotchas');
    expect(skill!.content).toContain('Escalate refunds over $500');

    const rules = await db.clawMemory.findMany({ where: { tenantId: TENANT_ID, kind: 'PROCEDURAL' } });
    expect(rules.every((r) => (r.value as { synthesizedIntoSkill?: string }).synthesizedIntoSkill === 'sys-billing')).toBe(true);
  });

  it('never overwrites a user-owned skill at the same slug', async () => {
    await db.clawSkill.create({ data: { tenantId: TENANT_ID, slug: 'sys-billing', name: 'My Own Billing Skill', description: 'hand-written', tier: 'read-only', content: 'do not touch', source: 'user', isEnabled: true } });
    await seedMaturedRule('rule-one');
    await seedMaturedRule('rule-two');
    const model = new FakeListChatModel({ responses: ['unused'] });

    const created = await synthesizeDomainSkills({ tenantId: TENANT_ID, userId: USER_ID, distillerModel: model });
    expect(created).toBe(0);
    const skill = await db.clawSkill.findFirst({ where: { tenantId: TENANT_ID, slug: 'sys-billing' } });
    expect(skill!.content).toBe('do not touch');
  });

  it('stamps rules but does not refresh content when the system skill is disabled (user veto)', async () => {
    await db.clawSkill.create({ data: { tenantId: TENANT_ID, slug: 'sys-billing', name: 'Billing', description: 'x', tier: 'read-only', content: 'frozen content', source: 'system', isEnabled: false } });
    await seedMaturedRule('rule-one');
    await seedMaturedRule('rule-two');
    const model = new FakeListChatModel({ responses: ['unused'] });

    const created = await synthesizeDomainSkills({ tenantId: TENANT_ID, userId: USER_ID, distillerModel: model });
    expect(created).toBe(0);
    const skill = await db.clawSkill.findFirst({ where: { tenantId: TENANT_ID, slug: 'sys-billing' } });
    expect(skill!.content).toBe('frozen content');
    const rules = await db.clawMemory.findMany({ where: { tenantId: TENANT_ID, kind: 'PROCEDURAL' } });
    expect(rules.every((r) => (r.value as { synthesizedIntoSkill?: string }).synthesizedIntoSkill === 'sys-billing')).toBe(true);
  });

  it('never throws — a distiller failure resolves to 0', async () => {
    await seedMaturedRule('rule-one');
    await seedMaturedRule('rule-two');
    const model = new FakeListChatModel({ responses: [] }); // no responses configured → invoke() throws
    await expect(synthesizeDomainSkills({ tenantId: TENANT_ID, userId: USER_ID, distillerModel: model })).resolves.toBe(0);
  });

  it('respects AUTO_SKILL_CREATION_ENABLED=false', async () => {
    process.env.AUTO_SKILL_CREATION_ENABLED = 'false';
    await seedMaturedRule('rule-one');
    await seedMaturedRule('rule-two');
    const model = new FakeListChatModel({ responses: ['unused'] });
    expect(await synthesizeDomainSkills({ tenantId: TENANT_ID, userId: USER_ID, distillerModel: model })).toBe(0);
  });
});
```

- [ ] **Step 4: Run it → fails**

Run: `cd libs/claw-studio && bunx vitest run src/skills/skill-synthesis.test.ts` → FAIL (module doesn't exist).

- [ ] **Step 5: Implement**

Create `libs/claw-studio/src/skills/skill-synthesis.ts`:

```ts
/**
 * skill-synthesis.ts — domain-level autonomous skill synthesis, ported from
 * nucleus lib/agent/memory/skill-synthesis.ts. Replaces per-rule promotion:
 * when a procedural domain accumulates enough MATURED rules, a distiller
 * authors a narrative playbook and code appends a deterministic ledger of
 * every matured rule (knowledge can never be lost to distiller omission).
 * One system skill per domain (`sys-<domain>`), content re-synthesized as
 * rules mature. Tier is LOCKED 'read-only'. Disabled system skill = veto
 * (stamp, don't touch). User-owned slugs are inviolable. At most one domain
 * per run. Never throws.
 *
 * Bridge: `agent_memories` -> `claw_memories`, and the query is scoped by
 * `(tenantId, userId)` — nucleus scopes by tenantId only, since its Skill/
 * memory model has no per-agent identity; Claw's memories already carry
 * `userId = claw.id` (Plan C2 convention), so this port filters by it too to
 * stay exactly scoped to the Claw whose memories are being examined.
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { extractTextContent } from '../agent/agent-shared';
import { getMemoryService } from '../memory/memory-service';

const logger = createLogger('claw-studio:skill-synthesis');

export function autoSkillCreationEnabled(): boolean {
  const v = process.env.AUTO_SKILL_CREATION_ENABLED?.toLowerCase();
  return !(v === 'false' || v === '0');
}

export function autoSkillMaturityThreshold(): number {
  const n = Number(process.env.AUTO_SKILL_MATURITY_THRESHOLD);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

export function skillSynthesisMinRules(): number {
  const n = Number(process.env.SKILL_SYNTHESIS_MIN_RULES);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

const MAX_EPISODES = 3;

interface RuleRow {
  id: string;
  key: string;
  value: Record<string, unknown>;
  sourceThreadId: string | null;
  accessCount: number;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

const DISTILLER_SYSTEM = new SystemMessage(
  `You author an operational skill document for an AI teammate, distilled from
rules the agent learned across real sessions (with episode evidence where available).
Return ONLY a JSON object: {"name": "...", "description": "...", "narrative": "..."}
- name: concise Title Case skill name (max 6 words) for the domain.
- description: one sentence saying when to use this skill.
- narrative: markdown with exactly these sections: "## Purpose", "## When to use",
  "## Workflow guidance", "## Safety notes". Ground every claim in the provided rules and
  episodes — never invent capabilities. Do NOT include a rules list; it is appended separately.`,
);

export async function synthesizeDomainSkills(params: {
  tenantId: string;
  userId: string;
  threadId?: string;
  distillerModel: BaseChatModel;
}): Promise<number> {
  if (!autoSkillCreationEnabled()) return 0;
  try {
    const prisma = getPrismaClient();
    const threshold = autoSkillMaturityThreshold();
    const minRules = skillSynthesisMinRules();

    // 1. Best candidate domain (tenant+claw bound; bare "procedures" namespaces excluded).
    const candidates = await prisma.$queryRaw<Array<{ domain: string; matured: number; pending: number }>>`
      SELECT split_part("namespace", '/', 2) AS domain,
             COUNT(*)::int AS matured,
             (COUNT(*) FILTER (WHERE ("value"->>'synthesizedIntoSkill') IS NULL))::int AS pending
      FROM claw_memories
      WHERE "tenantId" = ${params.tenantId}
        AND "userId" = ${params.userId}
        AND "kind" = 'PROCEDURAL'
        AND "supersededById" IS NULL
        AND "accessCount" >= ${threshold}
        AND split_part("namespace", '/', 2) <> ''
      GROUP BY 1
      HAVING COUNT(*) >= ${minRules}
         AND COUNT(*) FILTER (WHERE ("value"->>'synthesizedIntoSkill') IS NULL) >= 1
      ORDER BY 3 DESC
      LIMIT 1
    `;
    if (!candidates.length) return 0;
    const { domain, matured, pending } = candidates[0];
    const slug = `sys-${domain}`;
    logger.info({ tenantId: params.tenantId, userId: params.userId, domain, matured, pending, slug }, '[skill-synthesis] candidate domain found');

    // 2. Ownership / veto guard.
    const svc = getMemoryService();
    const existing = await prisma.clawSkill.findFirst({ where: { tenantId: params.tenantId, slug } });
    if (existing && existing.source !== 'system') {
      logger.warn({ tenantId: params.tenantId, slug, domain }, '[skill-synthesis] slug is user-owned — skipped');
      return 0;
    }

    // 3. Gather ALL matured rules for the domain (re-synthesis is total).
    const rules = await prisma.$queryRaw<RuleRow[]>`
      SELECT "id","key","value","sourceThreadId","accessCount"
      FROM claw_memories
      WHERE "tenantId" = ${params.tenantId}
        AND "userId" = ${params.userId}
        AND "kind" = 'PROCEDURAL'
        AND "supersededById" IS NULL
        AND "accessCount" >= ${threshold}
        AND split_part("namespace", '/', 2) = ${domain}
      ORDER BY "accessCount" DESC, "key" ASC
    `;
    if (!rules.length) return 0;
    const pendingRules = rules.filter((r) => !(r.value as Record<string, unknown>).synthesizedIntoSkill);
    const stampAll = async () => {
      for (const r of pendingRules) {
        try {
          await svc.update(params.tenantId, r.id, { ...r.value, synthesizedIntoSkill: slug });
        } catch (err) {
          logger.warn({ err, tenantId: params.tenantId, key: r.key }, '[skill-synthesis] failed to stamp rule (non-fatal)');
        }
      }
    };

    // Disabled system skill = standing veto: acknowledge the rules, touch nothing.
    if (existing && !existing.isEnabled) {
      logger.info({ tenantId: params.tenantId, slug, pending: pendingRules.length }, '[skill-synthesis] skill disabled (user veto) — stamping only');
      await stampAll();
      return 0;
    }

    // 4. Episode evidence via provenance join (the runs that taught these rules).
    const threadKeys = Array.from(new Set(
      rules.map((r) => r.sourceThreadId).filter((t): t is string => !!t).map((t) => `thread-${t}`),
    ));
    let episodes: Array<{ key: string; value: Record<string, unknown> }> = [];
    if (threadKeys.length) {
      try {
        episodes = await prisma.$queryRaw<Array<{ key: string; value: Record<string, unknown> }>>`
          SELECT DISTINCT "key","value"
          FROM claw_memories
          WHERE "tenantId" = ${params.tenantId}
            AND "userId" = ${params.userId}
            AND "kind" = 'EPISODIC'
            AND "supersededById" IS NULL
            AND "key" = ANY(${threadKeys}::text[])
          LIMIT ${MAX_EPISODES}
        `;
      } catch {
        // evidence is optional
      }
    }

    // 5. Distill the narrative. Rules missing trigger/instruction (only possible on
    // manually-mutated/legacy rows — the save-time validator forbids them) are excluded
    // from all rendered content so 'undefined' never reaches a prompt or skill body.
    const renderableRules = rules.filter((r) => {
      const v = r.value as { instruction?: string; trigger?: string };
      return !!v?.instruction && !!v?.trigger;
    });
    if (!renderableRules.length) {
      logger.warn({ tenantId: params.tenantId, domain }, '[skill-synthesis] no renderable rules — skipped');
      return 0;
    }
    const rulesText = renderableRules.map((r) => {
      const v = r.value as { instruction?: string; trigger?: string; evidence?: string };
      return `- [${r.key}] When ${v.trigger}: ${v.instruction} (evidence: ${v.evidence || 'n/a'}; reinforced ${r.accessCount}x)`;
    }).join('\n');
    const episodesText = episodes.map((e) => {
      const v = e.value as { context?: string; outcome?: string };
      return `- ${v.context ?? '(context n/a)'} → ${v.outcome ?? '(outcome n/a)'}`;
    }).join('\n') || '(none)';
    const input = new HumanMessage(
      `**Domain:** ${domain}\n\n**Matured rules:**\n${rulesText}\n\n` +
      `**Episode evidence:**\n${episodesText}\n\n` +
      `**Existing skill content:**\n${existing?.content ? existing.content.slice(0, 6000) : '(none — new skill)'}\n\n` +
      `Author the skill document now.`,
    );

    const resp = await params.distillerModel.invoke([DISTILLER_SYSTEM, input]);
    const content = extractTextContent(resp.content);
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      logger.warn({ tenantId: params.tenantId, domain }, '[skill-synthesis] distiller returned no JSON — will retry next run');
      return 0;
    }
    const parsed = JSON.parse(match[0]) as { name?: string; description?: string; narrative?: string };
    if (!isNonEmptyString(parsed.name) || !isNonEmptyString(parsed.description) || !isNonEmptyString(parsed.narrative)) {
      logger.warn({ tenantId: params.tenantId, domain }, '[skill-synthesis] distiller output invalid — will retry next run');
      return 0;
    }

    // 6. Assemble: narrative + code-guaranteed rule ledger.
    const ledger = renderableRules.map((r) => {
      const v = r.value as { instruction?: string; trigger?: string; evidence?: string };
      return `- When ${v.trigger}: ${v.instruction} — evidence: ${v.evidence || '(not recorded)'}`;
    }).join('\n');
    const skillContent =
      `${parsed.narrative.trim()}\n\n` +
      `## Learned rules & gotchas\n${ledger}\n\n` +
      `_Synthesized by Claw from ${renderableRules.length} matured procedural rules. ` +
      `Managed automatically — content refreshes as new rules mature; disable this skill to stop updates._`;

    // 7. Create or update.
    if (!existing) {
      try {
        await prisma.clawSkill.create({
          data: {
            tenantId: params.tenantId, slug, name: parsed.name.trim(), description: parsed.description.trim(),
            tier: 'read-only', content: skillContent, source: 'system', isEnabled: true,
            createdBy: null, sourceRunId: params.threadId ?? null,
          },
        });
        logger.info({ tenantId: params.tenantId, domain, slug, rules: rules.length }, '[skill-synthesis] created skill');
      } catch (err) {
        if ((err as { code?: string })?.code !== 'P2002') throw err;
        const winner = await prisma.clawSkill.findFirst({ where: { tenantId: params.tenantId, slug } });
        if (!winner || winner.source !== 'system') {
          logger.warn({ tenantId: params.tenantId, slug }, '[skill-synthesis] created concurrently by another owner — skipped');
          return 0;
        }
        await prisma.clawSkill.update({ where: { id: winner.id }, data: { content: skillContent, description: parsed.description.trim() } });
        logger.info({ tenantId: params.tenantId, slug }, '[skill-synthesis] refreshed after create race');
      }
    } else {
      await prisma.clawSkill.update({ where: { id: existing.id }, data: { content: skillContent, description: parsed.description.trim() } });
      logger.info({ tenantId: params.tenantId, domain, slug, rules: rules.length }, '[skill-synthesis] refreshed skill content');
    }

    // 8. Acknowledge incorporation.
    await stampAll();
    return 1;
  } catch (err) {
    logger.warn({ err, tenantId: params.tenantId }, '[skill-synthesis] synthesis failed (non-fatal)');
    return 0;
  }
}
```

- [ ] **Step 6: Un-stub `memory-nodes.ts`**

In `libs/claw-studio/src/memory/memory-nodes.ts`, replace:

```ts
/** Autonomous skill synthesis is wired in C4 — until then this is a no-op. */
async function synthesizeDomainSkills(): Promise<void> { /* wired in C4 */ }
```

with:

```ts
import { synthesizeDomainSkills } from '../skills/skill-synthesis';
```

(remove the local no-op function), and update its call site — find:

```ts
        // Autonomous skill synthesis — matured domains become/refresh enabled system skills.
        // Stubbed until C4 wires the real domain-skill matcher.
        if (proceduralMemoryEnabled()) {
            await synthesizeDomainSkills();
        }
```

replace with:

```ts
        // Autonomous skill synthesis — matured domains become/refresh enabled system skills.
        if (proceduralMemoryEnabled() && tenantId && userId) {
            await synthesizeDomainSkills({ tenantId, userId, threadId: threadIdForEpisode, distillerModel: reflectorModel });
        }
```

(`threadIdForEpisode` and `reflectorModel` are already in scope in `memorySaveNode` — no new parameters needed.)

- [ ] **Step 7: Export + run tests**

Add to `libs/claw-studio/src/index.ts`:

```ts
export {
  synthesizeDomainSkills, autoSkillCreationEnabled, autoSkillMaturityThreshold, skillSynthesisMinRules,
} from './skills/skill-synthesis';
```

Run: `cd libs/claw-studio && bunx vitest run src/skills/skill-synthesis.test.ts` → PASS (7 tests).
Run: `cd libs/claw-studio && bunx vitest run src/memory/memory-nodes.test.ts` → still whatever its current pass/fail state is (pre-existing `vi.mock` issue, unrelated — do not attempt to fix as part of this task).
Run: `bunx nx typecheck claw-studio` → no errors.

- [ ] **Step 8: Commit**

```bash
git add libs/claw-studio/src
git commit -m "feat(claw-studio): skill-synthesis ported — un-stubs Plan C2's no-op"
```

---

### Task 4: Wire skills into the executor graph

**Files:**
- Modify: `libs/claw-studio/src/agent/claw-graph.ts` (evaluator prompt gets the skill catalog + returns `skillId`; `getDynamicContext` uses real skill content; tools include `load_skill`)
- Modify: `libs/claw-studio/src/agent/claw-runtime.ts` (load `skillContentMap`, bind `createLoadSkillTool`)
- Create: `libs/claw-studio/src/skills/skill-tool.ts`
- Test: `libs/claw-studio/src/skills/skill-tool.test.ts`
- Modify: `libs/claw-studio/src/agent/claw-graph.test.ts` (new coverage for skill selection)
- Modify: `libs/claw-studio/src/index.ts`

**Interfaces:**
- `ClawGraphDeps` gains `skillContentMap?: Map<string, string>` (default empty).
- `createLoadSkillTool(tenantId: string)` — same contract as nucleus.
- Evaluator's `RequestEvaluation.skillId` is no longer hardcoded `null` — it's parsed from the same LLM call, validated against the enabled catalog.

- [ ] **Step 1:** Read nucleus's `apps/web-ui/lib/agent/skill-tool.ts` (37 lines) before writing the port.

- [ ] **Step 2: Write the failing test for the tool**

Create `libs/claw-studio/src/skills/skill-tool.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSkillContentMock = vi.fn();
const getSkillSummariesMock = vi.fn();
vi.mock('./skill-service', () => ({ getSkillContent: getSkillContentMock, getSkillSummaries: getSkillSummariesMock }));

import { createLoadSkillTool } from './skill-tool';

describe('createLoadSkillTool', () => {
  beforeEach(() => {
    getSkillContentMock.mockReset();
    getSkillSummariesMock.mockReset();
  });

  it('returns the wrapped skill content when found and enabled', async () => {
    getSkillContentMock.mockResolvedValue('Do the thing carefully.');
    const tool = createLoadSkillTool('tenant-1');
    const result = await tool.invoke({ skill_id: 'billing-basics' } as never);
    expect(String(result)).toContain('SKILL LOADED: BILLING-BASICS');
    expect(String(result)).toContain('Do the thing carefully.');
  });

  it('returns an error message with the catalog when the skill is missing or disabled', async () => {
    getSkillContentMock.mockResolvedValue(null);
    getSkillSummariesMock.mockResolvedValue('Available Skills:\n- other: Other Skill - desc');
    const tool = createLoadSkillTool('tenant-1');
    const result = await tool.invoke({ skill_id: 'nope' } as never);
    expect(String(result)).toContain('not found or not enabled');
    expect(String(result)).toContain('Available Skills');
  });
});
```

Note: this test relies on `vi.mock` intercepting a relative sibling import — per the environment limitation already documented in `memory-tools.test.ts`, this may not intercept correctly when run as part of the full suite. If it doesn't (verify with `bunx vitest run src/skills/skill-tool.test.ts` in isolation vs the full run), fall back to the same real-DB integration style `memory-tools.test.ts` uses (seed a `ClawSkill` row, call the tool for real, assert on output) rather than fighting the mock.

- [ ] **Step 3: Run it → fails**

Run: `cd libs/claw-studio && bunx vitest run src/skills/skill-tool.test.ts` → FAIL (module doesn't exist).

- [ ] **Step 4: Implement the tool**

Create `libs/claw-studio/src/skills/skill-tool.ts`:

```ts
/**
 * skill-tool.ts — progressive disclosure of skills as a tool, ported from
 * nucleus lib/agent/skill-tool.ts. The system prompt carries only the skill
 * catalog (name + description); the agent calls load_skill(skill_id) at the
 * moment a task phase needs those instructions. Tenant-scoped and
 * enabled-only: getSkillContent() returns null for disabled/unknown slugs,
 * so a disabled skill (veto) can never be loaded mid-run.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import { getSkillContent, getSkillSummaries } from './skill-service';

const logger = createLogger('claw-studio:skill-tool');

export function createLoadSkillTool(tenantId: string) {
  return tool(
    async ({ skill_id }: { skill_id: string }) => {
      const slug = skill_id.trim();
      const content = await getSkillContent(tenantId, slug);
      if (!content) {
        const catalog = await getSkillSummaries(tenantId).catch(() => 'No specialized skills available.');
        return `Error: skill "${slug}" not found or not enabled for this tenant.\n\n${catalog}`;
      }
      logger.info({ tenantId, slug }, '[load_skill] loaded skill into context');
      return `=== SKILL LOADED: ${slug.toUpperCase()} ===\n${content}\n=== END SKILL ===\n\nFollow these instructions — they define your privileges, safety constraints, and workflow — for all work within this skill's scope.`;
    },
    {
      name: 'load_skill',
      description:
        'Load the full instructions of a specialized skill by its id. The available skills are listed in your system prompt under "Available Skills". Call this BEFORE starting work that a skill\'s description covers — the loaded instructions define privileges, safety rules, and workflow for that scope. You may load multiple skills over the course of one task as different phases require them. Do not call it for skills already loaded in this conversation.',
      schema: z.object({
        skill_id: z.string().describe('The skill id (slug) exactly as listed in the Available Skills catalog'),
      }),
    },
  );
}
```

- [ ] **Step 5: Wire skill catalog + selection into the evaluator**

In `libs/claw-studio/src/agent/claw-graph.ts`:
- Import `loadSkills` from `../skills/skill-service`.
- In `evaluatorNode`, before building `systemPrompt`, fetch the catalog:

```ts
    const availableSkills = tenantId ? await loadSkills(tenantId) : [];
    const skillsContext = availableSkills.map((s) => `- ${s.id}: ${s.name} - ${s.description}`).join('\n');
```

- Extend the evaluator's system prompt to include the catalog and ask for `skillId`, matching nucleus exactly:

```ts
    const systemPrompt = new SystemMessage(`You are an intelligent request evaluator for an agentic AI system.
Your job is to analyze the user's request and determine the best execution approach.

Available Skills:
${skillsContext}

Return a JSON object with this exact schema:
{
    "mode": "plan" | "end",
    "skillId": string | null,
    "requiresApproval": boolean,
    "reasoning": string,
    "clarificationQuestion": string | null,
    "missingInfo": string | null
}

Rules:
- "plan" for every executable task — all runs are planned, executed, and reflected on
- "end" ONLY when genuinely ambiguous — always set clarificationQuestion in this case
- requiresApproval=true for any create/update/delete/start/stop operations
- "skillId": pick the single most relevant skill from Available Skills ONLY when the request clearly matches its description; otherwise null. When in doubt, return null.

Return only the JSON object.`);
```

- Update the result-parsing block to read `skillId` from the parsed JSON and validate it against the enabled catalog (mirrors `auto-skill-select.ts`'s membership check, applied inline instead of in a separate call):

```ts
      if (parsed) {
        const requestedSkillId = typeof parsed.skillId === 'string' ? parsed.skillId : null;
        const matchedSkill = requestedSkillId ? availableSkills.find((s) => s.id === requestedSkillId) : undefined;
        evalResult = {
          mode: parsed.mode === 'end' ? 'end' : 'plan',
          skillId: matchedSkill ? matchedSkill.id : null,
          skillName: matchedSkill ? matchedSkill.name : null,
          accountId: null,
          requiresApproval: !!parsed.requiresApproval,
          reasoning: parsed.reasoning || '',
          clarificationQuestion: parsed.clarificationQuestion || null,
          missingInfo: parsed.missingInfo || null,
          knowledgeBaseIds: [],
        };
      }
```

(Update the `parseJsonObject<{...}>` type argument in `evaluatorNode` to add `skillId?: string | null`.)

- [ ] **Step 6: Wire real skill content into prompts**

In `createClawGraph`, accept the new dep:

```ts
export interface ClawGraphDeps {
  // ...existing fields...
  skillContentMap?: Map<string, string>;
}
```

and in `createClawGraph`'s body:

```ts
  const skillContentMap = deps.skillContentMap ?? new Map<string, string>();
```

In `getDynamicContext`, replace the hardcoded `buildEffectiveSkillSection(skillId, null, null)` call with:

```ts
  function getDynamicContext(evaluation: RequestEvaluation | null, memoryContext = '') {
    const skillId = evaluation?.skillId ?? null;
    const skillContent = skillId ? (skillContentMap.get(skillId) ?? null) : null;
    const skillSection = buildEffectiveSkillSection(skillId, skillContent, null);
    // ...rest unchanged...
```

- [ ] **Step 7: Bind `load_skill` into the tool list**

In `createClawGraph`, update the tools default:

```ts
  const tools = deps.tools ?? (tenantId && userId
    ? [...createMemoryTools(tenantId, userId), createLoadSkillTool(tenantId)]
    : []);
```

(Import `createLoadSkillTool` from `../skills/skill-tool`.)

- [ ] **Step 8: `claw-runtime.ts` — load the skill content map**

In `resolveClawRuntime`, import `loadAllSkillContent` from `@chatbot/claw-studio`'s own local skills module path (`../skills/skill-service`) and add:

```ts
  const skillContentMap = await loadAllSkillContent(tenantId);
```

and pass it through to `createClawGraph({ ..., skillContentMap })`.

- [ ] **Step 9: Extend `claw-graph.test.ts`**

Add a new test to `libs/claw-studio/src/agent/claw-graph.test.ts`:

```ts
it('selects a skill via the evaluator and injects its content into the generate system prompt', async () => {
  const model = new FakeListChatModel({
    responses: [
      JSON.stringify({ mode: 'plan', requiresApproval: false, skillId: 'billing-basics' }), // evaluator
      JSON.stringify(['Answer using the billing skill']), // planner
      'Used the billing skill.', // generate
      '## What Was Accomplished\nAnswered using the skill.', // final
    ],
  });
  const graph = createClawGraph({
    model, autoApprove: true,
    skillContentMap: new Map([['billing-basics', 'ALWAYS_CHECK_INVOICE_TABLE_MARKER']]),
  });
  const result = await graph.invoke(
    { messages: [new HumanMessage('What is our refund policy?')] },
    { configurable: { thread_id: 'test-thread-skill' } },
  );
  expect(result.evaluation?.skillId).toBe('billing-basics');
});
```

(This test doesn't mock `loadSkills` — since `tenantId` is undefined in this test's deps, `loadSkills` is never called (`tenantId ? await loadSkills(tenantId) : []` short-circuits), so `availableSkills` is `[]` and the evaluator's own catalog-membership check would normally reject `'billing-basics'` as unmatched... Re-check this against Step 5's membership-validation logic before finalizing: if no tenantId is provided, this test's `skillId` would come back `null` since `matchedSkill` requires `availableSkills.find(...)` to succeed, and `availableSkills` is empty. **Adjust the test to pass a real `tenantId` and either seed a real `ClawSkill` row (integration-style, matching `memory-tools.test.ts`'s pattern) or accept this as coverage for the `skillContentMap` injection path only, with a separate integration test in Task 4's own skill-tool/skill-service tests covering evaluator catalog matching against a real seeded skill.** Do not leave this contradiction unresolved — pick one and make the test assert what actually happens.)

- [ ] **Step 10: Export + run tests**

Add to `libs/claw-studio/src/index.ts`:

```ts
export { createLoadSkillTool } from './skills/skill-tool';
```

Run: `cd libs/claw-studio && bunx vitest run src/skills src/agent/claw-graph.test.ts src/agent/claw-runtime.test.ts` → all PASS.
Run: `bunx nx typecheck claw-studio` → no errors.

- [ ] **Step 11: Commit**

```bash
git add libs/claw-studio/src
git commit -m "feat(claw-studio): wire skill catalog/selection/content/load_skill into the graph"
```

---

### Task 5: Skill export utilities

**Files:**
- Create: `libs/claw-studio/src/skills/skill-export.ts`
- Test: `libs/claw-studio/src/skills/skill-export.test.ts`
- Modify: `libs/claw-studio/src/index.ts`

**Interfaces:** Produces `buildSkillMarkdown(skill)`, `buildAllSkillsMarkdown(skills)`, `buildSkillFile(skill)` (pure — unit-testable) plus `exportSkillToFile`, `exportSkillToMarkdown`, `exportAllSkillsToMarkdown`, `exportAllSkillsToZip` (impure, DOM+Blob — exercised by the UI, not unit tests). Also ports the shared `fence`/`anchor`/`fileSafe`/`yamlScalar`/`downloadBlob`/`downloadText` helpers nucleus keeps in a separate `export-utils.ts`.

- [ ] **Step 1:** Read nucleus's `apps/web-ui/lib/skill-export.ts` (113 lines) and `apps/web-ui/lib/export-utils.ts` before writing.

- [ ] **Step 2: Write the failing test** (pure functions only)

Create `libs/claw-studio/src/skills/skill-export.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSkillMarkdown, buildAllSkillsMarkdown, buildSkillFile } from './skill-export';

const skill = {
  id: 'billing-basics', name: 'Billing Basics', description: 'When asked about invoices', tier: 'read-only',
  source: 'user', isEnabled: true, createdBy: 'user-1', content: 'Check ```the``` invoice table.',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('buildSkillMarkdown', () => {
  it('includes the metadata table and a fence long enough to survive backticks in content', () => {
    const md = buildSkillMarkdown(skill);
    expect(md).toContain('# Billing Basics');
    expect(md).toContain('| Tier | read-only |');
    expect(md).toMatch(/````markdown/); // 4 backticks since content has a 3-backtick run
    expect(md).toContain('Check ```the``` invoice table.');
  });
});

describe('buildAllSkillsMarkdown', () => {
  it('reports no skills to export for an empty list', () => {
    expect(buildAllSkillsMarkdown([])).toContain('_No skills to export._');
  });

  it('sorts skills alphabetically and includes a table of contents', () => {
    const b = { ...skill, id: 'a-skill', name: 'A Skill' };
    const md = buildAllSkillsMarkdown([skill, b]);
    expect(md.indexOf('A Skill')).toBeLessThan(md.indexOf('Billing Basics'));
  });
});

describe('buildSkillFile', () => {
  it('produces SKILL.md-style YAML frontmatter followed by content', () => {
    const file = buildSkillFile(skill);
    expect(file).toMatch(/^---\nname: "Billing Basics"/);
    expect(file).toContain('enabled: "true"'.replace('"true"', 'true')); // enabled: true, unquoted boolean
    expect(file.trim().endsWith(skill.content.trim())).toBe(true);
  });
});
```

- [ ] **Step 3: Run it → fails**

Run: `cd libs/claw-studio && bunx vitest run src/skills/skill-export.test.ts` → FAIL.

- [ ] **Step 4: Implement**

Create `libs/claw-studio/src/skills/skill-export.ts`:

```ts
/**
 * Skill -> Markdown export, ported from nucleus lib/skill-export.ts +
 * lib/export-utils.ts (inlined here rather than a separate shared module,
 * since this is the only exporter in Claw Studio so far — split it out if a
 * second one appears, e.g. for Memory Runtimes export).
 */

export interface SkillDTO {
  id: string;
  name: string;
  description: string;
  tier: string;
  source: string;
  isEnabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  content?: string;
}

/** Wrap content in a code fence one backtick longer than the longest backtick run inside it. */
export function fence(content: string, lang = 'markdown'): string {
  const longestRun = content.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
  const marker = '`'.repeat(Math.max(3, longestRun + 1));
  return `${marker}${lang}\n${content}\n${marker}`;
}

/** GitHub-style heading anchor. */
export function anchor(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}

export function fileSafe(text: string, fallback = 'item'): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

export function yamlScalar(value: string): string {
  const v = value ?? '';
  if (v.includes('\n')) {
    const indented = v.split('\n').map((l) => `  ${l}`).join('\n');
    return `|-\n${indented}`;
  }
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadText(content: string, filename: string, mimeType = 'text/markdown;charset=utf-8'): void {
  downloadBlob(new Blob([content], { type: mimeType }), filename);
}

/** Build the Markdown document for a single skill. Pure. */
export function buildSkillMarkdown(skill: SkillDTO): string {
  const content = skill.content ?? '';
  return [
    `# ${skill.name}`, '', `> ${skill.description}`, '',
    '| Field | Value |', '| --- | --- |',
    `| Slug | \`${skill.id}\` |`, `| Tier | ${skill.tier} |`, `| Source | ${skill.source} |`,
    `| Status | ${skill.isEnabled ? 'Enabled' : 'Disabled'} |`,
    `| Created | ${skill.createdAt} |`, `| Updated | ${skill.updatedAt} |`,
    `| Created by | ${skill.createdBy ?? '—'} |`, '',
    '## Content', '', fence(content), '',
  ].join('\n');
}

/** Build the Markdown document for a collection of skills (table of contents + each skill). Pure. */
export function buildAllSkillsMarkdown(skills: SkillDTO[]): string {
  const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  const header: string[] = ['# Skills export', '', `Exported ${sorted.length} skill(s).`, ''];
  if (sorted.length === 0) {
    header.push('_No skills to export._', '');
    return header.join('\n');
  }
  header.push('## Table of contents', '');
  for (const s of sorted) header.push(`- [${s.name}](#${anchor(s.name)})`);
  header.push('', '---', '');
  const body = sorted.map((s) => `${buildSkillMarkdown(s)}\n---\n`);
  return `${header.join('\n')}\n${body.join('\n')}`;
}

/** Build a portable SKILL.md document: YAML frontmatter + content. Pure. */
export function buildSkillFile(skill: SkillDTO): string {
  const frontmatter = [
    '---',
    `name: ${yamlScalar(skill.name)}`,
    `description: ${yamlScalar(skill.description)}`,
    `tier: ${yamlScalar(skill.tier)}`,
    `enabled: ${skill.isEnabled ? 'true' : 'false'}`,
    '---', '',
  ].join('\n');
  return `${frontmatter}\n${skill.content ?? ''}\n`;
}

export function exportSkillToFile(skill: SkillDTO): void {
  downloadText(buildSkillFile(skill), `${skill.id || fileSafe(skill.name, 'skill')}.md`);
}

export function exportSkillToMarkdown(skill: SkillDTO): void {
  downloadText(buildSkillMarkdown(skill), `skill-${fileSafe(skill.name, 'skill')}.md`);
}

export function exportAllSkillsToMarkdown(skills: SkillDTO[]): void {
  downloadText(buildAllSkillsMarkdown(skills), `skills-export-${new Date().toISOString().slice(0, 10)}.md`);
}

/**
 * Download all skills as a `.zip` of portable SKILL.md files, one per skill
 * at `skills/<slug>/SKILL.md` (the Claude Code skill layout). jszip is
 * dynamically imported so it stays out of the main bundle for users who
 * never export.
 */
export async function exportAllSkillsToZip(skills: SkillDTO[]): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const root = zip.folder('skills');
  if (!root) throw new Error('Failed to create skills folder in zip');
  for (const s of [...skills].sort((a, b) => a.name.localeCompare(b.name))) {
    root.file(`${s.id}/SKILL.md`, buildSkillFile(s));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `skills-export-${new Date().toISOString().slice(0, 10)}.zip`);
}
```

- [ ] **Step 5: Export + run tests**

Add to `libs/claw-studio/src/index.ts`:

```ts
export {
  buildSkillMarkdown, buildAllSkillsMarkdown, buildSkillFile,
  exportSkillToFile, exportSkillToMarkdown, exportAllSkillsToMarkdown, exportAllSkillsToZip,
} from './skills/skill-export';
export type { SkillDTO } from './skills/skill-export';
```

Run: `cd libs/claw-studio && bunx vitest run src/skills/skill-export.test.ts` → PASS.

- [ ] **Step 6: Add `jszip` to root `package.json`** (build-time dependency for the async import above; per this repo's convention framework/runtime deps resolve from root):

```json
    "jszip": "^3.10.1",
```

Run: `bun install`.

- [ ] **Step 7: Commit**

```bash
git add libs/claw-studio/src package.json bun.lock
git commit -m "feat(claw-studio): skill export utilities (Markdown, SKILL.md, zip)"
```

---

### Task 6: Promote-from-memory helper (for future Memory Runtimes UI)

**Files:**
- Create: `libs/claw-studio/src/skills/promote.ts`
- Test: `libs/claw-studio/src/skills/promote.test.ts`
- Modify: `libs/claw-studio/src/index.ts`

**Interfaces:** Produces `buildSkillDraftFromMemory(row): SkillDraft | null` — a pure function turning one `PROCEDURAL` `ClawMemory` row into a skill draft. Not consumed by any UI yet (Memory Runtimes' promote-to-skill button is a later phase per the agreed sequencing) — ships now since it's tiny and skill-shaped, ready to wire up when Memory Runtimes lands.

- [ ] **Step 1:** Read nucleus's `apps/web-ui/lib/agent-memory/promote.ts` (38 lines) before writing.

- [ ] **Step 2: Write the failing test**

Create `libs/claw-studio/src/skills/promote.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSkillDraftFromMemory } from './promote';

describe('buildSkillDraftFromMemory', () => {
  it('returns null for a non-PROCEDURAL row', () => {
    expect(buildSkillDraftFromMemory({ kind: 'SEMANTIC', key: 'x', value: {} } as never)).toBeNull();
  });

  it('returns null when instruction/trigger are missing', () => {
    expect(buildSkillDraftFromMemory({ kind: 'PROCEDURAL', key: 'x', value: { instruction: 'do it' } } as never)).toBeNull();
  });

  it('builds a read-only draft from a valid procedural row, humanizing the key as the name', () => {
    const draft = buildSkillDraftFromMemory({
      kind: 'PROCEDURAL', key: 'paginate-list-calls',
      value: { instruction: 'Always paginate list calls', trigger: 'any list operation', evidence: 'missed a resource once' },
    } as never);
    expect(draft).toEqual({
      name: 'Paginate List Calls',
      description: 'any list operation',
      tier: 'read-only',
      content: expect.stringContaining('Always paginate list calls'),
    });
    expect(draft!.content).toContain('missed a resource once');
  });
});
```

- [ ] **Step 3: Run it → fails**

Run: `cd libs/claw-studio && bunx vitest run src/skills/promote.test.ts` → FAIL.

- [ ] **Step 4: Implement**

Create `libs/claw-studio/src/skills/promote.ts`:

```ts
/**
 * promote.ts — procedural memory -> Skill draft mapping, ported from nucleus
 * lib/agent-memory/promote.ts. Pure; persistence happens through the normal
 * create-skill path (Task 7's API route), human-approved via a UI action —
 * not consumed yet (ships ahead of Memory Runtimes, which will add the
 * "Promote to skill" button that calls this).
 */

export interface MemoryRowLike {
  kind: string;
  key: string;
  value: Record<string, unknown>;
}

export interface SkillDraft {
  name: string;
  description: string;
  tier: string;
  content: string;
}

function humanize(key: string): string {
  return key
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => (w[0]?.toUpperCase() ?? '') + w.slice(1))
    .join(' ');
}

export function buildSkillDraftFromMemory(row: MemoryRowLike): SkillDraft | null {
  if (row.kind !== 'PROCEDURAL') return null;
  const v = row.value as { instruction?: string; trigger?: string; evidence?: string };
  if (!v?.instruction || !v?.trigger) return null;
  return {
    name: humanize(row.key),
    description: v.trigger,
    tier: 'read-only',
    content:
      `## Rule\n${v.instruction}\n\n` +
      `## When it applies\n${v.trigger}\n\n` +
      `## Why (evidence)\n${v.evidence || '(not recorded)'}\n\n` +
      `_Learned by Claw; promoted from procedural memory._`,
  };
}
```

- [ ] **Step 5: Export + run tests**

Add to `libs/claw-studio/src/index.ts`:

```ts
export { buildSkillDraftFromMemory } from './skills/promote';
export type { MemoryRowLike, SkillDraft } from './skills/promote';
```

Run: `cd libs/claw-studio && bunx vitest run src/skills/promote.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/claw-studio/src
git commit -m "feat(claw-studio): memory-to-skill promotion helper (for Memory Runtimes, later)"
```

---

### Task 7: Mission Control API routes

**Files:**
- Create: `apps/mission-control/app/api/skills/route.ts` (GET list, POST create)
- Create: `apps/mission-control/app/api/skills/[id]/route.ts` (GET, PATCH, DELETE)
- Create: `apps/mission-control/app/api/skills/distill/route.ts` (POST — transcript → skill draft, no persistence)
- Modify: `apps/mission-control/tsconfig.json` / `next.config.ts` if new transitive imports need transpiling (verify by build)

**Interfaces:**
- `GET /api/skills?all=1&withContent=1` → `{ success: true, skills: SkillDTO[] }`
- `POST /api/skills` (Zod-validated body) → `201 { success: true, data: SkillDTO }` / `409` on slug collision
- `GET/PATCH/DELETE /api/skills/[id]` (id = slug) → same DTO shape
- `POST /api/skills/distill` (Zod-validated `{ transcript: string }`) → `{ success: true, data: { name, description, tier, content } }`

- [ ] **Step 1:** Read nucleus's three route files (`app/api/skills/route.ts`, `app/api/skills/[id]/route.ts`, `app/api/skills/distill/route.ts`, all already captured in full in this plan's research) before writing. Note the two deliberate corrections this port makes: Zod validation at the boundary (nucleus has none), and Studio-session auth instead of RBAC `authorize()`.

- [ ] **Step 2: Implement `GET`/`POST /api/skills`**

Create `apps/mission-control/app/api/skills/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { slugify } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:skills');

const createSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tier: z.enum(['read-only', 'mutation', 'approval-gated']),
  content: z.string().min(1),
  isEnabled: z.boolean().optional().default(true),
  slug: z.string().optional(),
  source: z.enum(['user', 'system']).optional().default('user'),
  sourceRunId: z.string().nullable().optional(),
});

function toDTO(s: { slug: string; name: string; description: string; tier: string; source: string; isEnabled: boolean; createdBy: string | null; createdAt: Date; updatedAt: Date; content?: string }, includeContent = false) {
  const dto = {
    id: s.slug, name: s.name, description: s.description, tier: s.tier, source: s.source,
    isEnabled: s.isEnabled, createdBy: s.createdBy, createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
  return includeContent ? { ...dto, content: s.content } : dto;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    const params = new URL(request.url).searchParams;
    const includeDisabled = params.has('all');
    const withContent = params.has('withContent');
    const skills = await getPrismaClient().clawSkill.findMany({
      where: { tenantId: session.studio.tenantId, ...(includeDisabled ? {} : { isEnabled: true }) },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ success: true, skills: skills.map((s) => toDTO(s, withContent)) });
  } catch (error) {
    logger.error({ error }, 'Failed to list skills');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    const parsed = createSkillSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    const tenantId = session.studio.tenantId;
    const { name, description, tier, content, isEnabled, source, sourceRunId } = parsed.data;
    const slug = parsed.data.slug?.trim() ? slugify(parsed.data.slug) : slugify(name);

    const db = getPrismaClient();
    const existing = await db.clawSkill.findFirst({ where: { tenantId, slug } });
    if (existing) {
      return NextResponse.json({ success: false, error: `A skill with slug "${slug}" already exists` }, { status: 409 });
    }

    let created;
    try {
      created = await db.clawSkill.create({
        data: { tenantId, slug, name, description, tier, content, source, isEnabled, createdBy: null, sourceRunId: sourceRunId ?? null },
      });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        return NextResponse.json({ success: false, error: `A skill with slug "${slug}" already exists` }, { status: 409 });
      }
      throw err;
    }
    logger.info({ tenantId, slug }, 'Skill created');
    return NextResponse.json({ success: true, data: toDTO(created) }, { status: 201 });
  } catch (error) {
    logger.error({ error }, 'Failed to create skill');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Implement `GET`/`PATCH`/`DELETE /api/skills/[id]`**

Create `apps/mission-control/app/api/skills/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { slugify } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:skills:id');

const updateSkillSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  tier: z.enum(['read-only', 'mutation', 'approval-gated']).optional(),
  content: z.string().min(1).optional(),
  isEnabled: z.boolean().optional(),
  slug: z.string().optional(),
}).strict();

function toDTO(s: { slug: string; name: string; description: string; tier: string; source: string; isEnabled: boolean; createdBy: string | null; content: string; createdAt: Date; updatedAt: Date }) {
  return { id: s.slug, name: s.name, description: s.description, tier: s.tier, source: s.source, isEnabled: s.isEnabled, createdBy: s.createdBy, content: s.content, createdAt: s.createdAt, updatedAt: s.updatedAt };
}

async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.studio?.tenantId) return null;
  return session;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    const { id } = await params;
    const skill = await getPrismaClient().clawSkill.findFirst({ where: { tenantId: session.studio.tenantId, slug: id } });
    if (!skill) return NextResponse.json({ success: false, error: 'Skill not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: toDTO(skill) });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch skill');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    const { id } = await params;
    const tenantId = session.studio.tenantId;
    const db = getPrismaClient();
    const existing = await db.clawSkill.findFirst({ where: { tenantId, slug: id } });
    if (!existing) return NextResponse.json({ success: false, error: 'Skill not found' }, { status: 404 });

    const parsed = updateSkillSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    const { slug: newSlugRaw, ...rest } = parsed.data;
    const updates: Record<string, unknown> = { ...rest };
    if (newSlugRaw !== undefined) updates.slug = slugify(newSlugRaw);

    let updated;
    try {
      updated = await db.clawSkill.update({ where: { id: existing.id }, data: updates });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        return NextResponse.json({ success: false, error: `A skill with slug "${updates.slug ?? existing.slug}" already exists` }, { status: 409 });
      }
      throw err;
    }
    logger.info({ tenantId, slug: id }, 'Skill updated');
    return NextResponse.json({ success: true, data: toDTO(updated) });
  } catch (error) {
    logger.error({ error }, 'Failed to update skill');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    const { id } = await params;
    const tenantId = session.studio.tenantId;
    const db = getPrismaClient();
    const existing = await db.clawSkill.findFirst({ where: { tenantId, slug: id } });
    if (!existing) return NextResponse.json({ success: false, error: 'Skill not found' }, { status: 404 });
    await db.clawSkill.delete({ where: { id: existing.id } });
    logger.info({ tenantId, slug: id }, 'Skill deleted');
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to delete skill');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Implement `POST /api/skills/distill`**

Create `apps/mission-control/app/api/skills/distill/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { createLogger, LlmProviderService } from '@chatbot/shared';
import { createClawModel } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:skills:distill');
const MAX_TRANSCRIPT_CHARS = 600_000;
const bodySchema = z.object({ transcript: z.string().min(1).max(MAX_TRANSCRIPT_CHARS) });

const DISTILL_PROMPT = `You are distilling Claw's chat transcript into a reusable "skill" — a
generalized procedure Claw can follow again for similar future requests.

The transcript may include tool-call/tool-result content showing the exact
tools or commands Claw actually used — infer the actual domain and tools
from the transcript itself; do not assume any specific system.

Return ONLY a JSON object (no markdown fences) with keys:
- "name": short Title Case name (max 5 words)
- "description": one sentence describing when to use this skill
- "tier": one of "read-only" | "mutation" | "approval-gated" — pick based on
  what the actual tool calls did:
  - "read-only": every tool call only queried/read/listed state, nothing was changed
  - "mutation": at least one tool call created, updated, deleted, sent, or posted something
  - "approval-gated": the transcript shows a destructive/irreversible action, or Claw explicitly asked for confirmation first
- "content": a markdown SKILL body with a one-line intro and a numbered,
  generalized step-by-step procedure GROUNDED in the actual tool calls made.
  Strip one-off identifiers and replace with placeholders — describe the
  repeatable method, not the one-off answer.

Transcript:
`;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const tenantId = session.studio.tenantId;
    const config = await new LlmProviderService(tenantId).getDefaultConfig();
    if (!config) {
      return NextResponse.json({ success: false, error: 'No LLM provider configured for this tenant' }, { status: 400 });
    }
    const model = createClawModel(config);
    const resp = await model.invoke(`${DISTILL_PROMPT}\n${parsed.data.transcript}`);
    const raw = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      logger.error({ tenantId }, 'Distill: model reply was not parseable JSON');
      return NextResponse.json({ success: false, error: 'Model did not return valid JSON' }, { status: 502 });
    }
    const draft = JSON.parse(match[0]) as { name?: string; description?: string; tier?: string; content?: string };
    const validTiers = ['read-only', 'mutation', 'approval-gated'];
    const tier = validTiers.includes(draft.tier ?? '') ? draft.tier : 'read-only';
    return NextResponse.json({
      success: true,
      data: { name: draft.name ?? 'Untitled Skill', description: draft.description ?? '', tier, content: draft.content ?? '' },
    });
  } catch (error) {
    logger.error({ error }, 'Failed to distill skill');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Verify build + typecheck**

Run: `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json` → no errors.
Run: `bunx nx build mission-control` → success.

- [ ] **Step 6: Commit**

```bash
git add apps/mission-control/app/api/skills
git commit -m "feat(mission-control): skills API routes (list/create/get/update/delete/distill)"
```

---

### Task 8: shadcn primitives + new dependencies

**Files:**
- Modify: `apps/mission-control/package.json` (add `@monaco-editor/react`, `react-hook-form`, `@hookform/resolvers`, `react-markdown`, `remark-gfm`, `@tanstack/react-table`, plus Radix deps for any newly-copied primitive not already present)
- Create: `apps/mission-control/components/ui/{badge,dialog,dropdown-menu,select,switch,tabs,form,markdown-content,data-table,data-table-column-header,spinner}.tsx`

**Interfaces:** Produces the shadcn primitives the Skills management UI needs, none of which exist in `apps/mission-control/components/ui/` yet (`textarea.tsx` already exists there from Plan C1 — do not recreate it).

- [ ] **Step 1: Copy primitives from web-ui verbatim**

Matching the established convention (Plan B, Plan C1): read each file at `apps/web-ui/components/ui/<name>.tsx` and write it unchanged to `apps/mission-control/components/ui/<name>.tsx`. Do this for: `badge.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `select.tsx`, `switch.tsx`, `tabs.tsx`, `data-table.tsx`, `data-table-column-header.tsx`, `spinner.tsx`. Verify each only imports Radix primitives + `@/lib/utils` (already present in mission-control) — if any imports something else mission-control lacks, pull that transitively too (read its imports first, per Plan B's own established check).

- [ ] **Step 2: `form.tsx`** — copy `apps/web-ui/components/ui/form.tsx` verbatim (standard shadcn react-hook-form wrapper, already captured in full in this plan's research) to `apps/mission-control/components/ui/form.tsx`. Depends on `@/components/ui/label` (already present).

- [ ] **Step 3: `markdown-content.tsx`** — copy `apps/web-ui/components/ui/markdown-content.tsx` verbatim (already captured in full in this plan's research) to `apps/mission-control/components/ui/markdown-content.tsx`. Depends on `react-markdown` + `remark-gfm` (added in Step 5).

- [ ] **Step 4: Radix deps for the newly-copied primitives**

Add to `apps/mission-control/package.json` `dependencies` (check each copied file's actual Radix import first — these are the ones nucleus's versions use):

```json
    "@radix-ui/react-switch": "^1.1.0",
    "@radix-ui/react-select": "^2.1.0",
    "@radix-ui/react-tabs": "^1.1.0",
```

(`@radix-ui/react-dialog` and `@radix-ui/react-dropdown-menu` are already declared in mission-control's `package.json` from Plan B/C1 — only the wrapper component files were missing, not the underlying Radix packages.)

- [ ] **Step 5: New non-Radix dependencies**

Add to `apps/mission-control/package.json` `dependencies`:

```json
    "@monaco-editor/react": "^4.7.0",
    "react-hook-form": "^7.54.1",
    "@hookform/resolvers": "^3.10.0",
    "react-markdown": "^10.1.0",
    "remark-gfm": "^4.0.1"
```

and to `dependencies` (or check if root already has it — verify with `grep react-table` first):

```json
    "@tanstack/react-table": "^8.21.3"
```

Run: `bun install`.

- [ ] **Step 6: Verify build + typecheck**

Run: `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json` → no errors (all copied primitives resolve their imports).
Run: `bunx nx build mission-control` → success.

- [ ] **Step 7: Commit**

```bash
git add apps/mission-control/components/ui apps/mission-control/package.json package.json bun.lock
git commit -m "feat(mission-control): shadcn primitives + deps for the Skills management UI"
```

---

### Task 9: Client service + TanStack Query hooks

**Files:**
- Create: `apps/mission-control/lib/client-skill-service.ts`
- Create: `apps/mission-control/hooks/use-skills.ts`

**Interfaces:** `ClientSkillService` (`listSkills`, `listSkillsWithContent`, `getSkill`, `createSkill`, `updateSkill`, `deleteSkill`, `distill`) + `useSkills`, `useSkill`, `useCreateSkill`, `useUpdateSkill`, `useDeleteSkill`, `useDistillSkill` hooks — same contracts as nucleus's `lib/client-skill-service.ts` + `lib/queries/skills.ts`, with inline query keys (mission-control has no `query-keys.ts` module yet — a `['skills', ...]` array scheme is used directly rather than porting a whole shared-keys file for one query group).

- [ ] **Step 1:** Read nucleus's `apps/web-ui/lib/client-skill-service.ts` (already captured in full) before writing.

- [ ] **Step 2: Implement the client service**

Create `apps/mission-control/lib/client-skill-service.ts`:

```ts
export interface SkillDTO {
  id: string;
  name: string;
  description: string;
  tier: string;
  source: string;
  isEnabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  content?: string;
}

export interface SkillInput {
  name: string;
  description: string;
  tier: string;
  content: string;
  isEnabled?: boolean;
  slug?: string;
  source?: string;
  sourceRunId?: string | null;
}

async function jsonOrThrow(res: Response) {
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const ClientSkillService = {
  async listSkills(all = true): Promise<SkillDTO[]> {
    const res = await fetch(`/api/skills${all ? '?all=1' : ''}`);
    return (await jsonOrThrow(res)).skills as SkillDTO[];
  },
  async listSkillsWithContent(all = true): Promise<SkillDTO[]> {
    const params = new URLSearchParams();
    if (all) params.set('all', '1');
    params.set('withContent', '1');
    const res = await fetch(`/api/skills?${params.toString()}`);
    return (await jsonOrThrow(res)).skills as SkillDTO[];
  },
  async getSkill(id: string): Promise<SkillDTO> {
    return (await jsonOrThrow(await fetch(`/api/skills/${id}`))).data;
  },
  async createSkill(input: SkillInput): Promise<SkillDTO> {
    return (await jsonOrThrow(await fetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }))).data;
  },
  async updateSkill(id: string, input: Partial<SkillInput>): Promise<SkillDTO> {
    return (await jsonOrThrow(await fetch(`/api/skills/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }))).data;
  },
  async deleteSkill(id: string): Promise<void> {
    await jsonOrThrow(await fetch(`/api/skills/${id}`, { method: 'DELETE' }));
  },
  async distill(transcript: string): Promise<{ name: string; description: string; tier: string; content: string }> {
    return (await jsonOrThrow(await fetch('/api/skills/distill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript }) }))).data;
  },
};
```

- [ ] **Step 3: Implement the query hooks**

Create `apps/mission-control/hooks/use-skills.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClientSkillService, type SkillInput } from '@/lib/client-skill-service';

const skillsKey = { all: ['skills'] as const, list: (all: boolean) => ['skills', 'list', all] as const, detail: (id: string) => ['skills', 'detail', id] as const };

export function useSkills(all = true) {
  return useQuery({ queryKey: skillsKey.list(all), queryFn: () => ClientSkillService.listSkills(all) });
}
export function useSkill(id: string | null) {
  return useQuery({ queryKey: skillsKey.detail(id ?? ''), queryFn: () => ClientSkillService.getSkill(id as string), enabled: !!id });
}
export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: SkillInput) => ClientSkillService.createSkill(input), onSuccess: () => qc.invalidateQueries({ queryKey: skillsKey.all }) });
}
export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: Partial<SkillInput> }) => ClientSkillService.updateSkill(id, input), onSuccess: () => qc.invalidateQueries({ queryKey: skillsKey.all }) });
}
export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => ClientSkillService.deleteSkill(id), onSuccess: () => qc.invalidateQueries({ queryKey: skillsKey.all }) });
}
export function useDistillSkill() {
  return useMutation({ mutationFn: (transcript: string) => ClientSkillService.distill(transcript) });
}
```

- [ ] **Step 4: Verify typecheck**

Run: `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mission-control/lib/client-skill-service.ts apps/mission-control/hooks/use-skills.ts
git commit -m "feat(mission-control): skills client service + TanStack Query hooks"
```

---

### Task 10: Management UI

**Files:**
- Create: `apps/mission-control/components/skills/skill-form-dialog.tsx`
- Create: `apps/mission-control/components/skills/skill-detail-dialog.tsx`
- Create: `apps/mission-control/components/skills/skills-client.tsx`
- Modify: `apps/mission-control/app/(console)/skills/page.tsx` (replace the "coming soon" stub)

**Interfaces:** Produces the same UI nucleus ships: a searchable, sortable skills data table with create/edit/clone/view/delete/enable-toggle/export actions.

- [ ] **Step 1:** Read nucleus's three component files (already captured in full in this plan's research) before writing.

- [ ] **Step 2: `skill-form-dialog.tsx`** — port verbatim from nucleus's `components/skills/skill-form-dialog.tsx` (139 lines), adjusting only imports: `@/lib/queries/skills` → `@/hooks/use-skills`, `@/lib/client-skill-service` stays the same relative shape (mission-control's own file from Task 9). No `initialDraft`/`sourceRunId` props are wired up by any caller yet (nucleus's "distill from transcript" flow into this dialog isn't built here — the `/api/skills/distill` route exists standalone for now; wiring a "distill this conversation" button into the Chat page is a natural fast-follow, not part of this task) — keep the props on the component for parity, just don't add a caller.

Create `apps/mission-control/components/skills/skill-form-dialog.tsx` with nucleus's exact structure (imports updated per above), full content as captured in research.

- [ ] **Step 3: `skill-detail-dialog.tsx`** — port verbatim from nucleus's `components/skills/skill-detail-dialog.tsx` (82 lines), imports adjusted to `@/hooks/use-skills`.

- [ ] **Step 4: `skills-client.tsx`** — port verbatim from nucleus's `components/skills/skills-client.tsx` (242 lines), with these adjustments:
  - `@/lib/queries/skills` → `@/hooks/use-skills`
  - `@/lib/skill-export` → `@chatbot/claw-studio` (the export functions from Task 5 are already there; re-export or import directly)
  - Header copy: `"Reusable agent skills for AI Ops and Agent Ops."` → `"Reusable skills for Claw."` (nucleus-specific product copy, not a functional change)

- [ ] **Step 5: Replace the page stub**

Replace `apps/mission-control/app/(console)/skills/page.tsx`:

```tsx
import { SkillsClient } from '@/components/skills/skills-client';

export default function SkillsPage() {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <SkillsClient />
    </div>
  );
}
```

- [ ] **Step 6: Flip the nav flag**

In `apps/mission-control/lib/nav-config.ts`:

```ts
  { name: 'Skills Runtimes', href: '/skills', icon: Sparkles, enabled: true },
```

- [ ] **Step 7: Verify build + typecheck + manual check**

Run: `cd apps/mission-control && bunx tsc --noEmit -p tsconfig.json` → no errors.
Run: `bunx nx build mission-control` → success.
Manual: log into Mission Control, open Skills Runtimes, create a skill, verify it appears in the table, toggle it disabled, edit it, clone it, export it (Markdown + SKILL.md), delete it. Report exactly which of these were exercised live vs only typechecked/built, per this repo's UI-verification standard.

- [ ] **Step 8: Commit**

```bash
git add apps/mission-control/components/skills "apps/mission-control/app/(console)/skills" apps/mission-control/lib/nav-config.ts
git commit -m "feat(mission-control): Skills Runtimes management page"
```

---

### Task 11: Full-lib verification

- [ ] **Step 1:** Run: `cd libs/claw-studio && bunx vitest run` → all tests pass (Tasks 1–6 plus untouched C1–C3 tests; pre-existing `reconcile.test.ts`/`episode.test.ts`/`memory-nodes.test.ts` failures remain out of scope per Plan C3's own note).
- [ ] **Step 2:** Run: `bunx nx typecheck claw-studio` and `bunx nx typecheck mission-control` → no errors.
- [ ] **Step 3:** Run: `bunx nx build claw-studio` and `bunx nx build mission-control` → both succeed.
- [ ] **Step 4:** Live browser verification per Task 10 Step 7 — do not report this plan complete without it (or an explicit, honest DONE_WITH_CONCERNS note about what couldn't be verified live and why, matching this repo's established convention from Plan C3).

---

## Self-Review

**Spec coverage:** design spec §6's "Skills Runtimes: Runtime live (graph loads skills); management screen" is fully delivered — both halves (Tasks 3–4 wire the runtime; Tasks 7–10 build the management screen), not staged as a later fast-follow. §8's reuse-map row "Skills ← skill loading/synthesis (memory-nodes.ts's skill-synthesis coupling)" is covered by Tasks 3–4.

**Port fidelity:** Tasks 2, 3, 5, 6 clone nucleus's service/synthesis/export/promote logic structurally verbatim (same function signatures, same SQL shape, same DISTILLER_SYSTEM prompt, same ledger-append pattern). Tasks 7, 10 clone the API contract and UI structure verbatim, with two *documented, deliberate* corrections (Zod validation added; Studio-session auth replaces RBAC) rather than silent deviations. Task 4's skill-selection wiring is corrected to match what Agent Ops' real executor graph does (inline in the evaluator), not what a same-named-but-unrelated nucleus module (`auto-skill-select.ts`) does for its *other* chat agents — this is flagged explicitly rather than blindly porting a file that isn't actually in the reference path Claw's graph mirrors.

**Known risk:** Task 4 Step 9's test has an acknowledged unresolved design question inline (whether the skill-selection test needs a real seeded `ClawSkill` row) — the step calls this out explicitly rather than leaving a plausible-looking-but-wrong test in place; resolve it during implementation, don't skip past the note.

**Type consistency:** `SkillDTO` (Task 9's client-side type) matches the API routes' `toDTO()` shape (Task 7) exactly. `SkillTier` (Task 2) matches the Zod `z.enum(['read-only','mutation','approval-gated'])` used in both the API routes (Task 7) and the form dialog (Task 10). `ClawGraphDeps.skillContentMap` (Task 4) is populated by `claw-runtime.ts`'s `loadAllSkillContent` (Task 2) with no shape mismatch.

**Placeholder scan:** none — every code step has complete code; copy-from-web-ui steps name the exact source files and forbid hand-rewrites, matching Plan B/C1/C3's own convention.

---

## Next plans (not in this document)

- **Plan C5 — MCP:** `ClawMcpServer` model, port `lib/agent/{mcp-manager,mcp-config,mcp-tools}.ts`, bind MCP tools into `createClawGraph`'s `tools` array alongside memory + skill tools, build the **MCP Configuration** management page.
- **Memory Runtimes UI (fast-follow):** browse/search/export `ClawMemory` rows (data layer already exists from Plan C2), wire Task 6's `buildSkillDraftFromMemory` into a "Promote to skill" button.
- **Plan C7 — Connectors:** gateway adapter registry + per-channel config, build the **Connectors** page.

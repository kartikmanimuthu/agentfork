# Mission Dashboard — Design Proposal

What the Mission Control dashboard (`apps/mission-control/app/(console)/dashboard`) should
contain, which data actually backs each widget today, and what has to be built first.

**Status:** proposal for approval. Nothing here is implemented.

> **All row counts below are for the real tenant (`smcnonprod`), verified through the
> tenant-scoped Prisma client.** This matters: `claw_memories` holds 95 rows globally but **75 of
> them belong to `test-tenant-*` fixtures** that aren't in the `tenants` table at all, plus 20
> `test-tenant-skill-synth-*` tenants from the skill-synthesis suite. The dashboard is
> tenant-scoped so it will never show them — but any figure quoted from a raw `psql` count is
> inflated ~5x. See §10 for the fixture-cleanup note.

Reference: [`nucleus_dashboard_spec.md`](./nucleus_dashboard_spec.md) (implementation spec for
the nucleus-cloud-ops dashboard) plus that project's `dashboard-refactor-plan.md` and
`dashboard-wireframes.md`, which contain the v2 design thesis written *after* their v1 shipped
and disappointed. This document ports the reasoning, not the AWS specifics.

---

## 1. Where we're starting from

Today's dashboard is one card: the Claw's name, "Autonomous teammate", and `Auto-approve: on|off`.
No metrics, no charts, no aggregation (~45 lines, `app/(console)/dashboard/page.tsx`).

Meanwhile the console has five other pages — Chat, Skills, Memory, MCP, Connectors — each with
real data behind it, and none of it surfaces on the landing page.

### The finding that shapes everything below

**Claw has no persisted run history.** It executes synchronously inside the chat HTTP request
(`api/chat/route.ts` → `resolveClawRuntime` → `graph.stream()`), and `agent/run-manager.ts` is
an in-process `globalThis` Map of AbortControllers that dies with the process. There is no
`ClawRun`/`ClawRunEvent` table.

That matters because in nucleus, **five of seven zones are powered by `AgentOpsRun` /
`AgentOpsEvent`** — hero agent-runs, pending approvals, action-center triage, runs-by-source,
top-tools, success rate, avg duration. None of those can be ported as-is.

What we do have is the LangGraph checkpointer (`checkpoints` table, 656 rows). It is not a
substitute:

- No `tenantId` column — only `thread_id`, so every query must join through
  `claw_conversations.threadId`.
- No turn semantics. A checkpoint is written per *graph node execution*, so 623 checkpoints
  represent a handful of conversations, not 623 turns. Counting them measures graph verbosity.
- Timestamps and step names are buried in `checkpoint->>'ts'` and `metadata.step` — derivable,
  but it means JSON-mining a table whose shape LangGraph owns and can change.
- It is already polluted: of 34 threads, **33 are `persistence-test-*` rows left behind by the
  test suite**. Any checkpoint-derived metric would be wrong on a dev machine today. (Worth
  cleaning up regardless of this proposal.)

So the proposal splits into **Phase 1 — ships on data that exists** and **Phase 2 — needs a run
model first**. Phase 1 is a genuinely useful dashboard on its own.

---

## 2. Principles adopted (from the nucleus v2 refactor)

Their v1 mistake was **one zone per backend domain** — the dashboard mirrored the schema, so no
screen answered a question anyone actually had. The v2 rules, which apply to us unchanged:

1. **One story per screen.** Zones answer user questions in a fixed order: *Is Claw working? →
   What needs me? → Why / can I trust it?* A zone that maps to a table instead of a question
   gets cut.
2. **Truthful data.** Never render a plausible-looking zero. If something isn't configured, say
   "not configured" and link to the setup. Their named failure modes are the ones to avoid:
   a headline number that was silently a placeholder constant, two zones disagreeing (0% vs
   100% success) because they read different tables, an "Other" bucket swallowing 94% of rows,
   and a raw internal ID displayed as "Top User".
3. **Clickable everything.** Every number, bar, and row links to the page filtered to that
   slice. `href` comes from the server in the payload, never assembled in the component.
4. **Semantic colour only**, and **status is a dot plus a label** — never colour alone.
5. **Zone independence.** Each zone owns its own fetch, skeleton, error, and empty state. One
   failing zone shows an inline error card; the rest of the page works.
6. **Width encodes importance.** Responsive grid, not a scroll stack of identical cards.
7. **A zone with no story gets demoted**, not kept for completeness — theirs became a
   conditional setup CTA.

Also worth copying verbatim: **skeletons shape-matched to the zone** (not spinners), error cards
with Retry, and empty states whose copy names the next action ("No skills yet — Create one →").

---

## 3. Non-goals for v1

Nucleus shipped these as explicit non-goals and then reversed one of them in v2. Taking their
corrected position: drilldowns are in from day one, the rest stay out.

- No websockets or polling — **manual refresh only** (their "Real-time health" subtitle over a
  page with no `refetchInterval` is a wart worth not reproducing; either poll or don't claim it).
- No drag-and-drop widget customisation — that's what Custom Dashboards already is (§6).
- No CSV/PDF export, no alert thresholds, no period-over-period chart overlays.
- No per-zone permissions. One read check gates the page.

---

## 4. Phase 1 — zones that ship on existing data

Four zones. Layout: hero KPI row, then a 2/3 + 1/3 row, then a two-column row.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Mission Dashboard                              [ Last 7 days   ▾ ]  │
├────────┬────────┬────────┬────────┬────────┬────────────────────────┤
│Memories│ Skills │ Tools  │Connect.│Providers│  Critical Events      │  HERO
├────────┴────────┴────────┴────────┴────────┴────────────────────────┤
│  Action Center                    [n] │  Readiness                  │  2/3 + 1/3
├───────────────────────────────────────┼─────────────────────────────┤
│  Memory & Learning                    │  Activity & Audit           │  1/2 + 1/2
└───────────────────────────────────────┴─────────────────────────────┘
```

### 4.1 Hero KPIs — `zone=hero`

Six cards. Every one is backed by a real count today.

| Card | Question | Source | Notes |
| --- | --- | --- | --- |
| Memories | How much has Claw learned? | `claw_memories` count | 20 rows for the real tenant |
| Skills enabled | What can it do? | `claw_skills` where `isEnabled` | split user vs `source:'system'` in the subtitle |
| Tools available | What can it reach? | `mcp_servers` where `status:'active'` + discovered tool count from `models`/`config` | 0 tools with 1 active server is a real state worth showing |
| Connectors active | Where can it be reached? | `tenant_configs` keys `claw-connector-*` with `enabled:true` | see §5 caveat |
| LLM provider | Is a model configured? | `llm_providers` where `isDefault` | show the model name; "not configured" links to setup |
| Critical events | Anything alarming? | `audit_logs` where `severity IN ('critical','high')` in range | real vocabulary already in use |

**Deltas:** only include a delta arrow where a previous-period comparison is genuinely
computable (memories and audit events have `createdAt`; skills/tools/connectors are current-state
counts). Nucleus hardcoded zero deltas on two cards and shipped a `computeDelta` that
short-circuits to neutral whenever the previous period is 0 — so two of their six arrows are
structurally always grey. **Cards without a real delta should render no delta row at all**, not a
fake neutral one.

**Sparklines:** only Memories has a defensible one (`claw_memories.createdAt`). Caveat: for the
real tenant every row was written on a single day, so today it renders as **one bar, not a
trend** — it fills in with use. The others get none. Nucleus ships `sparkline: []` on five of six
cards; better to make that explicit in the type than to have five cards silently render an empty
strip.

### 4.2 Action Center — `zone=action-center`

The one zone that deliberately breaks the one-zone-per-domain rule: a cross-domain triage inbox
of only the actionable, time-sensitive rows, each linking to the thing you'd do about it.
Nucleus's v2 notes conceive of it as a *feed* (eventually also a Slack/email digest), not a panel.

Available today:

| Group | Source | Row action |
| --- | --- | --- |
| MCP servers erroring | `mcp_servers.status = 'error'` | → `/mcp` |
| Connector configured but disabled | `tenant_configs` `claw-connector-*` with `enabled:false` | → `/connectors/<channel>` |
| No LLM provider / no default | `llm_providers` empty or none `isDefault` | → provider setup |
| Auto-created skills awaiting review | `claw_skills` where `source:'system'` | → `/skills` — these are written autonomously by skill-synthesis with no human gate, so surfacing them *is* the review step |
| Memories expiring soon | `claw_memories.expiresAt` within 7 days | → `/memory` |
| High/critical audit events | `audit_logs` severity in range | → audit view (needs a page; see §5) |

"Memories expiring soon" deserves a call-out: `claw_memories` carries a hard 90-day
`expiresAt` TTL, so learned knowledge silently evaporates. Nothing in the product currently
tells anyone that. It's the most genuinely actionable item available today.

**Badge honesty:** nucleus's badge counts the DB fetch (capped `take: 10` each, max 40) while the
UI renders at most 9 rows — so the number and the list disagree by design. Either cap both or
show "9 of 23"; don't ship the mismatch.

### 4.3 Readiness — `zone=readiness`

Their Coverage zone answers "can I trust these numbers?" — how much of the fleet reports, and how
fresh. Claw's structural analogue is setup completeness and tool reachability:

- **Setup checklist** with a progress bar: LLM provider ✓ / skills ✓ / MCP server ✓ /
  connector ✓ / memory embeddings ✓. Each unmet item is a link, not a red X.
- **Tool reachability** — per MCP server: `status`, transport, discovered tool count, and last
  successful test. Note: nothing currently *persists* the result of the `/mcp-servers/[id]/test`
  probe, so "last checked" needs either a column or an explicit "never checked" state. Do not
  invent a green tick for an untested server — that is exactly the "plausible-looking zero"
  failure.
- **Memory embedding health** — how many `claw_memories` rows have a null `embedding`. Those
  rows exist (the memory node logs "Embedding failed — storing without embedding") and they are
  invisible to vector recall, so this is a real, silent degradation.

### 4.4 Memory & Learning — `zone=memory`

The richest data we have (95 rows, three kinds, access counts). Answers "is Claw actually
learning, and is any of it being used?"

- **By kind**: SEMANTIC 12 / PROCEDURAL 7 / EPISODIC 1 for the real tenant. Horizontal bars —
  with three segments a donut is defensible, but per the wireframe rules, a single-segment donut
  never is.
- **Most-accessed memories**: top 5 by `accessCount`, linking to `/memory`. Real values today
  (34 / 31 / 20). Show the memory's `key`, **not** the raw id — nucleus surfaced an internal id
  as "Top User" and named it as a defect. Note one real key is
  `thread-claw_cmrymr5mo…_GrU9c0WIJc4v`, which is an id wearing a label; episodic keys need
  friendlier rendering or exclusion from this list.
- **Write trend**: per-day `createdAt` counts. The closest available proxy for "Claw was working"
  until Phase 2 lands. **Label it as memory writes, not as activity** — conflating the two is
  precisely the truthfulness failure the principles warn about.
- **Recall utilisation**: rows with a non-null `lastAccessedAt` over total. Conceptually the
  honest version of "is the memory any good" — but it reads **20 of 20 (100%) today**, so it has
  no signal yet and by the single-value rule should be omitted until it doesn't. Listed here so
  it isn't forgotten, not recommended for the first cut.
- **Superseded / reconciled**: `supersededById` count. Currently 0. Same story — worth knowing
  eventually, no signal now.

### 4.5 Activity & Audit — `zone=audit`

- **Recent events** from `audit_logs` — `eventType`, `severity`, `status`, actor, timestamp.
  Real rows exist (`claw.connector.updated`, `claw.connector.reset`, `ClawStudio.create`,
  `auth.session.login`).
- **By severity** pills, skipping zero counts.
- **Conversation count** — `claw_conversations`. Honest caveat: this is 1 per Claw today because
  `getOrCreateClawConversation` does `findFirst`. It becomes meaningful only once multi-thread
  chat lands (there is a separate approved-but-unbuilt plan for that). Until then, either omit
  the card or label it plainly. Do not dress a hardcoded 1 up as a metric.

Note that Mission Control writes **no audit rows of its own** except the connector events added
recently — so this zone starts sparse. That's an argument for instrumenting audit as part of
Phase 2, not for faking the zone now.

---

## 5. Known gaps in Phase 1 — state these in the UI, don't paper over them

| Gap | Consequence | Honest treatment |
| --- | --- | --- |
| Connectors store config in `tenant_configs`, no dedicated table | Counting them means key-prefix scanning `claw-connector-*`; secrets live in the same JSON blob | Read only `enabled`; never decrypt for a count |
| MCP test results not persisted | "Tool reachability" has no timestamp | Show "never checked", not a green tick |
| `sourceThreadId` populated on only 18/95 memories (19%) | Can't reliably attribute memories to conversations | Don't build a per-thread memory widget |
| No audit page in Mission Control | Audit rows have nowhere to drill into | Either add a minimal one or make rows non-clickable, flagged as such |
| `claw_working_memory` is empty (0 rows) | No compaction has run | Omit any working-memory widget until it has data |
| 33 `persistence-test-*` checkpoint threads | Any checkpoint-derived metric is wrong locally | Clean the test fixtures up; don't build on checkpoints anyway |

---

## 6. Reuse — and what NOT to duplicate

**Custom Dashboards already exists and is fully built** in web-ui: `Dashboard` /
`DashboardWidget` models, `DashboardQueryService`, a server-side `SOURCE_REGISTRY`,
`/api/dashboards/*` (list/create/widgets/layout/query/registry), a react-grid-layout canvas, and
a "Custom Dashboards" nav entry. That is *user-configurable BI* — a different product surface
from a curated landing page, so the Mission Dashboard is not a duplicate. But two decisions
follow:

1. **Don't build a second widget/query framework.** The Mission Dashboard is a fixed set of
   curated zones with bespoke queries, exactly like nucleus's. No `querySpec`, no viz registry.
2. **`DashboardQueryService` + `SOURCE_REGISTRY` are a real reuse candidate** if we later want
   Claw data available to user-built widgets too. Caveat found in the audit:
   `SOURCE_REGISTRY` currently has only two sources (`sessions`, `session_analytics`) and
   `DashboardQueryDb.model()` **hard-branches between those two models** — so adding Claw
   sources is a code change there, not a config addition. Out of scope for this proposal;
   worth knowing before anyone assumes it's free.

There is **no generic analytics/metrics service** in `libs/` to reuse. The closest thing is
`apps/web-ui/app/api/analytics/summary/route.ts` — a ~160-line un-extracted route handler. Don't
import from it; don't copy its shape either.

**Architecture to follow** (nucleus's, which held up): one endpoint `GET /api/dashboard?zone=&range=`
rather than five routes; per-zone query keys so switching range refetches only range-dependent
zones; all aggregation server-side so components only format. Two things of theirs to fix rather
than copy: every drilldown `href` in their repository is missing the `/app` prefix so **all their
dashboard links 404**, and their zone queries carry silent row caps (`take: 10000` / `5000`) past
which numbers are simply wrong with no UI signal. Cap explicitly and disclose it, or aggregate in
SQL.

---

## 7. Phase 2 — what a run model would unlock

Not proposed for build yet; listed so Phase 1 doesn't get designed into a corner.

Adding `ClawRun` (id, tenantId, clawId, conversationId, status, taskDescription, startedAt,
completedAt, durationMs, tokens, error) plus `ClawRunEvent` (runId, eventType, node, toolName,
toolArgs, toolOutput, metadata) would enable:

- **Run history + per-run timeline** — the single most valuable thing nucleus has and we don't.
  Their `run-timeline/` components render typed steps (planning, thinking, tool call/result with
  collapsible JSON, memory recall/save with hit distances and reconcile counts, reflection,
  final, error) with grouped tool calls and live auto-scroll. Claw's graph already *produces*
  every one of these; `getClawHistory` throws all of it away except the final message. Mostly a
  matter of not discarding what's already computed.
- **Real activity KPIs** — runs, success rate, avg duration, token spend.
- **Pending approvals in the Action Center.** Approval state currently lives only in the
  LangGraph checkpoint (`state.next`), which is technically readable but only per-thread via
  `getState` — there is no way to query "all threads awaiting approval" across a tenant. This is
  the main reason the Action Center can't have its most important row in Phase 1.
- **Tool-usage stats** — which MCP tools actually get called, and their failure rate.
- **Cost/token trend**, once usage is recorded per run.

Sequencing note: much of Phase 2 depends on the multi-thread chat work (separate plan, approved
but unbuilt), since a run is naturally scoped to a conversation.

---

## 8. Open questions

1. **Time range** — nucleus offers 24h/7d/30d/90d, client-state only (not URL, resets on
   reload). With Claw data this thin, is 7d/30d/all-time enough? And should the range be a URL
   param so views are shareable?
2. **Phase 1 scope** — all four zones, or start with hero + Action Center and add the rest once
   there's more data to show?
3. **Refresh** — manual only (recommended), or a slow `refetchInterval`?
4. **Audit drilldown** — add a minimal audit page to Mission Control, or leave audit rows
   non-clickable in v1?
5. **Test-fixture cleanup** — clean the 33 `persistence-test-*` checkpoint threads and make the
   test suite tear down after itself? Independent of this work but adjacent.
6. **Empty-state strategy** — a brand-new tenant has zero of everything. Should the dashboard
   detect that and render a setup checklist *instead of* the zones, rather than five empty cards?
   (Nucleus demotes a story-less zone to a setup CTA; the same logic could apply to the whole
   page on first run.)

---

## 9. The easy-yes cut

Filtered on: plain Prisma reads (no raw SQL), no schema migration, no new instrumentation, no
dependency on unbuilt work, no new page needed to drill into, and **real signal on today's data**.
Every query below was executed against the live DB through the tenant-scoped client.

### Tier A — build these (real signal today, nothing to break)

| # | Widget | Query | Today's value |
| --- | --- | --- | --- |
| 1 | **Readiness checklist** | 4 counts already listed | provider ✓, skills ✓, MCP ✓, connectors ✗ — genuinely mixed, and its usefulness doesn't scale with data volume |
| 2 | **Memory by kind** | `clawMemory.groupBy({ by:['kind'] })` | SEMANTIC 12 / PROCEDURAL 7 / EPISODIC 1 — three real segments |
| 3 | **Top accessed memories** | `clawMemory.findMany({ orderBy:{accessCount:'desc'}, take:5, select:{key,kind,accessCount} })` | 34 / 31 / 20 — real names, real numbers |
| 4 | **Hero counts** (memories, skills, tools, provider) | 4 × `count` / `findFirst` | 20 / 2 / 1 / Bedrock·claude-sonnet-5 |
| 5 | **Recent audit events** | `auditLog.findMany({ take:10, orderBy:{createdAt:'desc'} })` | 10 real rows, real severity vocabulary |

Tier A is one `GET /api/dashboard` route, one server component, ~6 read-only queries in a
`Promise.all`. It cannot affect anything else: no writes, no migration, no shared-lib behaviour
change, no existing page touched.

### Tier B — same cost, reads zero right now

Structurally correct, trivially cheap, and self-improving as the product gets used — but they
render empty today, so they need honest empty-state copy rather than a bare `0`:

- **Memories expiring soon** (`expiresAt <= now+7d`) → **0**, because the 90-day TTL puts first
  expiry at 2026-10-25. High future value; nothing to show for ~3 months.
- **MCP servers erroring** (`status:'error'`) → **0** (1 active, 0 errored).
- **Auto-created skills awaiting review** (`source:'system'`) → **0** (both skills are `user`).
- **Memory write trend** → one bar (all 20 rows written on 2026-07-27).

Recommendation: build B's queries alongside A — they're the same `Promise.all` — but let each
render a CTA-bearing empty state instead of a zero tile.

### Tier C — not easy, keep out of Phase 1

- **Memory embedding health.** `embedding` is `Unsupported("vector(1024)")`, so **Prisma cannot
  filter or select it at all** — it isn't even in `ClawMemoryWhereInput` (verified: `Unknown
  argument 'embedding'`). Needs `$queryRaw`, and raw SQL bypasses the tenant middleware, so it
  would need manual `WHERE "tenantId" = $1`. Real value, real care — its own task.
- **Recall utilisation** and **superseded count** — single-valued today (100%, 0). Add when they
  say something.
- **Tool reachability "last checked"** — requires persisting `/mcp-servers/[id]/test` results
  (schema change).
- **Pending approvals** — not queryable across threads (§7).
- **Conversation count** — structurally 1 until multi-thread chat lands.
- **Critical-event drilldown** — the count is easy, but Mission Control has no audit page to link
  to; either add one or ship the rows non-clickable.

### Recommendation

Ship **Tier A + Tier B** as the first cut. That's hero + Readiness + Memory & Learning + a recent
audit list — four zones, no migration, no instrumentation, entirely additive. Defer the full
Action Center until it has more than three groups worth showing, and treat `ClawRun` (§7) as its
own piece of work, since that's where the remaining value sits and it carries genuine schema and
instrumentation cost.

---

## 10. Data-hygiene note (independent of this work)

The dev database carries test-fixture rows that the suites never clean up:

- **75 of 95 `claw_memories`** belong to `test-tenant-memory-tools` (30), `t1` (1), and 22
  `test-tenant-skill-synth-*` tenants (2 each) — none of which exist in `tenants`.
- **33 of 34 checkpoint threads** are `persistence-test-*`.

Tenant scoping means none of it reaches the dashboard, but it makes raw `psql` counts misleading
during development, and orphaned rows referencing non-existent tenants suggest the fixtures skip
teardown. Worth a cleanup pass and `afterAll` teardown in those suites.

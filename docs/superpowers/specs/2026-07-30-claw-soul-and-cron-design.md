# Claw Studio — Soul, Self-Authoring & Scheduled Tasks — Design Spec

**Date:** 2026-07-30
**Branch:** `feature/claw-studio`
**Status:** Approved design → ready for implementation plans
**Predecessor:** `2026-07-15-claw-studio-design.md` (Phase 1 spine, shipped)

---

## 1. Summary

Claw Studio today can chat, remember, use tools, and be triggered from Slack/Telegram/Discord.
What it cannot do is **be somebody** or **act on its own initiative**.

This spec closes both gaps, modelled on OpenClaw and Hermes Agent:

1. **Workspace files** — a `SOUL` / `AGENTS` / `IDENTITY` / `USER` / `TOOLS` / `HEARTBEAT` set,
   DB-backed, composed into the system prompt. Claw stops being "a helpful AI assistant" and
   becomes a specific teammate with a persona, an operating procedure, and a model of the human.
2. **Self-authoring tools** — Claw can read and rewrite those files, so it accumulates a model of
   the user over time instead of only accumulating memory rows. This is the "grows with you" loop.
3. **Scheduled tasks (cron)** — time-triggered autonomous runs with per-task tool grants and
   channel delivery, so *"read the Jira board and email me a report every day at 10am"* works
   unattended.
4. **Jira** — a channel connector (ported) plus read/write tools (new), because the flagship
   scheduled-task scenario needs to read a board.

The unifying goal: Claw should feel like a teammate that has an identity, learns who you are, and
does work while you sleep.

---

## 2. Context — what already exists

Substantially more than a greenfield build. Everything below is live and must not be disturbed.

| Area | State |
|---|---|
| Executor graph | `memory_recall → evaluator → planner → [approval_gate] → generate ⇄ tools ⇄ reflect → revise → final → memory_save`, Postgres checkpointer, `interruptBefore` HITL |
| Memory | `ClawMemory` (SEMANTIC/EPISODIC/PROCEDURAL, pgvector, supersede chain, reconcile), `ClawWorkingMemory` (rolling summary + scratchpad + compaction) |
| Skills | `ClawSkill` + `load_skill` tool + autonomous synthesis from matured procedural memory |
| Integrations | 8 connected, 30 tools — Gmail, Outlook, Email, Google Calendar, Google Drive, Notion, GitHub, HubSpot. OAuth broker + manual-token modes, multi-account |
| Connectors | Slack, Telegram, Discord — inbound webhooks, outbound replies, HIL approve/reject buttons |
| Runs | `ClawRun` + `ClawRunEvent` append-only timeline, event bus, notification router, runs UI |
| Other | MCP servers, LLM providers, Playground, Chat threads, Mission Dashboard |
| Queue | pg-boss 10.4 in workers + mission-control + web-ui; `claw-gateway-run` job |

### 2.1 Gap map vs OpenClaw / Hermes

| Capability | Today | Gap |
|---|---|---|
| `SOUL.md`, `AGENTS.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md` | one `Claw.systemPrompt` string (**and it is dead code — see §3**) | all of it |
| Agent edits its own config | `save_memory`, `search_memory`, `load_skill` only | all of it |
| Cron / scheduled tasks | none | all of it |
| Jira | `ChannelType` declares `'jira'`; no adapter. Board reading already possible via MCP today | connector only |
| Generic webhook trigger | per-channel signature-verified webhooks only | deferred (§12) |
| Email trigger (inbound) | Gmail/Outlook are outbound+read only | deferred (§12) |
| Heartbeat / dreaming sweep | per-turn reconcile only | deferred (§12) |
| Multiple named agents | one Claw per Studio, gated in `claw-service` | deferred (§12) |

### 2.2 Two findings that shape the design

**(a) `Claw.systemPrompt` is dead code.** `claw-graph.ts:108` destructures `deps.systemPrompt`, then
every node declares a local `const systemPrompt = new SystemMessage(...)` (lines 167, 274, 347, 452,
554, 607) that shadows it. Nothing interpolates the outer value. So the Claw's saved prompt **and**
the Playground's `overrides.systemPrompt` are both silently discarded; every node runs on the
hardcoded `buildBaseIdentity()` string. This is a live bug, and it is exactly the seam the workspace
files plug into. Fixing it is the first task.

**(b) The approval gate silently breaks unattended runs.** `gmail_send_message` classifies as
mutative (`/\bsend\b/i`), so `routeFromGenerateToTools` sends it to `mutative_approval_gate` and
`interruptBefore` pauses. A 10am scheduled report would end `awaiting_approval` and never send.
Blanket `autoApprove: true` fixes it but also auto-approves `delete_event`, `update_contact`, and
every mutative MCP tool the run reaches. Hence the per-task tool grant in §6.3.

---

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Single Claw per Studio.** Multi-agent deferred. | Ships souls + cron soonest; multi-agent is a separate effort once these are proven. |
| D2 | **Cron only** for triggers in this effort. | Webhook + email deferred to §12 with mechanism already chosen. |
| D3 | **DB-backed virtual workspace files**, not real files. | Multi-tenant hosted app; no per-tenant volumes, no filesystem I/O from Next.js. Versioned rows give rollback for free. |
| D4 | **No `MEMORY.md`.** | `ClawMemory` already does curated long-term memory relationally, with pgvector recall, reconcile, and a supersede chain. A parallel markdown memory is a second source of truth for the same facts, and the two will disagree. Memory stays in `ClawMemory`; the Memory Runtimes page already surfaces it. |
| D5 | **`soul` / `agents` / `identity` writes are approval-gated; `user` / `tools` / `heartbeat` write freely.** | Rewriting the persona is high-consequence and rare. Learning the user's preferences is the whole point and must not nag. Free by default via `tool-classifier.ts` — no classifier change needed (see §5.3). |
| D6 | **Per-task tool grants (`approvalMode` + `allowedTools`)**, not blanket auto-approve. | Least privilege for unattended runs. See §6.3. |
| D7 | **Jira = port nucleus's channel connector only.** Board reading via the Atlassian Rovo MCP server, which needs no code. | Nucleus's own docs draw exactly this line (§7). Hand-writing `jira_*` tools would duplicate a maintained upstream server and a second credential surface. |
| D8 | **No worker→HTTP hop for scheduled runs.** | Nucleus's sweeper POSTs to a web-ui trigger endpoint because its agent code lives in web-ui. `libs/claw-studio` is directly importable from `apps/workers` (`claw-gateway-run` already does it), so the tick creates the run in-process. Removes a network hop, a shared secret (`INTERNAL_API_KEY`), and a class of 401-misconfig failures. |
| D9 | **Persona injected only into speaking/acting nodes.** | `planner`, `generate`, `revise`, `final` get the composed persona. `evaluator` and `reflect` are internal classifiers — injecting a persona there would skew classification. |
| D10 | **`BOOT.md`, `BOOTSTRAP.md`, `canvas/` not ported.** | They assume a local gateway process and a desktop UI. No equivalent concept here. |

---

## 4. Part A — Workspace files

### 4.1 The file set

| slug | OpenClaw file | Purpose | Injected into | Char cap |
|---|---|---|---|---|
| `identity` | IDENTITY.md | name, emoji, role label | speaking nodes + UI chrome | 500 |
| `soul` | SOUL.md | persona, tone, values, boundaries | speaking nodes | 4000 |
| `agents` | AGENTS.md | operating procedure — what it does, how | speaking nodes | 8000 |
| `user` | USER.md | who the human is, prefs, comms style, active projects | speaking nodes | 4000 |
| `tools` | TOOLS.md | environment notes, tool cautions/preferences | tool-bearing nodes only (`generate`, `revise`) | 2000 |
| `heartbeat` | HEARTBEAT.md | checklist consulted on every scheduled run | **scheduled runs only** | 2000 |

Total composed cap **16000 chars**. Over-cap content is truncated with a visible
`<!-- truncated: soul exceeded 4000 chars -->` marker rather than silently cut — OpenClaw does the
same with `bootstrapMaxChars` / `bootstrapTotalMaxChars`.

A missing or empty file injects nothing and logs at debug. Never throws. (OpenClaw's behaviour: it
injects a "missing file" marker and continues.)

### 4.2 Composition

New `libs/claw-studio/src/agent/prompt-composer.ts`:

```ts
export type WorkspaceSlug = 'identity' | 'soul' | 'agents' | 'user' | 'tools' | 'heartbeat';
export type PromptSurface = 'speaking' | 'acting' | 'scheduled';

export interface ComposeInput {
  files: Map<WorkspaceSlug, string>;
  surface: PromptSurface;
  /** Overrides `agents` for this run only — carries deps.systemPrompt / Playground overrides. */
  agentsOverride?: string;
}

export function composeIdentity(input: ComposeInput): string;
```

Output order, each section omitted when empty:

```
=== WHO YOU ARE ===        ← identity
=== YOUR CHARACTER ===     ← soul
=== HOW YOU WORK ===       ← agents (or agentsOverride)
=== WHO YOU'RE HELPING === ← user
=== YOUR ENVIRONMENT ===   ← tools        [acting surfaces only]
=== EVERY SCHEDULED RUN === ← heartbeat   [scheduled surface only]
```

`buildBaseIdentity()` in `prompt-templates.ts` is rewritten to take the composed string and keep its
existing skill-override branch:

```ts
export function buildBaseIdentity(selectedSkill?: string | null, composed?: string): string {
  if (selectedSkill) return `You are an expert AI agent operating under the "${selectedSkill}" skill.`;
  return composed?.trim() || DEFAULT_IDENTITY;  // existing hardcoded string as fallback
}
```

`DEFAULT_IDENTITY` keeps today's exact text, so a tenant with no files behaves identically to now.
This is what makes the change safe to ship.

### 4.3 Seeding

On `StudioService.provision()` (and lazily on first read for existing tenants), seed the six files
from templates in `libs/claw-studio/src/agent/workspace-templates.ts`. Seeds are short and written to
be *edited*, not admired — e.g. `soul` ships three sentences and a `<!-- Tell Claw how to sound -->`
prompt. `identity` seeds `name: Claw`. `user` seeds empty with a comment inviting Claw to fill it in.

Seeding is idempotent (`skipDuplicates` on the unique `(clawId, slug)`).

### 4.4 Wiring

`claw-runtime.ts` loads the files once per run via a new `WorkspaceFileService`, passes the map into
`createClawGraph({ workspaceFiles, ... })`. `deps.systemPrompt` becomes `agentsOverride` — which is
what finally makes the Claw's saved prompt and the Playground override do something (§2.2a).

---

## 5. Part B — Self-authoring tools

### 5.1 Tools

New `libs/claw-studio/src/agent/file-tools.ts`, spliced into the tool array in `claw-runtime.ts`
next to `createMemoryTools`:

| Tool | Signature | Notes |
|---|---|---|
| `list_workspace_files` | `()` | slug, char count, last updated, who by |
| `read_workspace_file` | `({ slug })` | |
| `write_workspace_file` | `({ slug, content, reason })` | full replace; `reason` is required and stored on the revision |
| `edit_workspace_file` | `({ slug, oldText, newText, reason })` | surgical; errors if `oldText` absent or ambiguous. Avoids rewriting 4k of soul to add one line |

Tool descriptions explicitly tell Claw *when* to use them: record a durable user preference in
`user`, a learned operating rule in `agents`, and leave `soul` alone unless asked.

### 5.2 Revisions and revert

Every write bumps `ClawFile.version`, inserts a `ClawFileRevision` (content, `updatedBy`, `reason`,
`sourceRunId`), and writes an audit row. The UI shows a diff per revision and a one-click restore —
the `Reset` button from the OpenClaw reference UI.

### 5.3 Guardrails

- **Approval gating is free.** `write_workspace_file` and `edit_workspace_file` both match
  `/\bwrite\b/i` in `tool-classifier.ts`, so they already classify as mutative and route to
  `mutative_approval_gate`. No classifier change.
- **Per-slug policy** in `file-tools.ts`: writes to `user` / `tools` / `heartbeat` are added to the
  run's granted set so they pass the gate un-prompted (D5). `soul` / `agents` / `identity` prompt.
- **Per-run write cap** (default 5) so a reflection loop cannot churn the soul.
- **Env kill-switch** `CLAW_SELF_AUTHORING` — `off` | `user` (default) | `all`. `user` means Claw may
  write `user`/`tools`/`heartbeat` but `soul`/`agents`/`identity` are read-only to it (still editable
  by a human in the UI). Lets us watch behaviour before widening.

### 5.4 Scheduling tools

Also in this part, because it is what makes cron feel alive: `create_scheduled_task`,
`list_scheduled_tasks`, `update_scheduled_task`, `delete_scheduled_task`. Saying *"email me a Jira
report every day at 10am"* in chat creates the task, rather than pointing at a settings page.
`create_scheduled_task` is mutative (`/\bcreate\b/i`) → approval-gated automatically.

---

## 6. Part C — Scheduled tasks

### 6.1 Sweeper

Ported from nucleus `apps/workers/src/jobs/agent-ops-scheduler/index.ts`, which already hit and fixed
the naive design: `pgboss.schedule` is keyed by queue name, so per-task cron forces one queue **and
one poller** per task — at N tasks that is N indexed SELECTs per second doing nothing, plus a
consumer leak on task deletion.

The ported design: **one** sweeper on **one** tick queue.

**Module split** — the logic lives in the lib, the pg-boss wiring lives in the worker:

- `libs/claw-studio/src/scheduler/select-due-tasks.ts` — the pure due-selection function.
- `libs/claw-studio/src/scheduler/scheduled-task-service.ts` — CRUD, guards, `nextRunAt` maintenance.
- `apps/workers/src/jobs/claw-scheduler/` — pg-boss registration, sweep timer, tick handler.
  Mirrors `claw-gateway-run`'s `{ index, handler, register, schema }.ts` layout.

This keeps every testable decision in Vitest-covered lib code (§11) and leaves the worker as thin
wiring, matching how `claw-gateway-run` already delegates to `executeRun`.

- 30s sweep (`CLAW_SCHEDULER_SWEEP_MS`), cron evaluated in-app with `croner`, 60s due-window.
- `selectDueTasks(tasks, nowMs, windowMs)` lifted nearly verbatim — a pure function, already
  unit-tested upstream. Handles cron, interval (`nextRunAt` anchor + `advanceIntervalAnchor`), and a
  malformed cron is skipped with a warn, never thrown.
- `singletonKey: task:<taskId>` + `singletonSeconds: 60` dedupes across replicas.
- `sweepInFlight` guard; `stopSweeper()` called at the *start* of shutdown, before `boss.stop()`.
- `once` tasks flip to `status: 'completed'` after firing.

### 6.2 Tick → run

Per D8, in-process — no HTTP hop:

1. Acquire `ClawScheduledTaskLock` on `(taskId, scheduledAt)`; `ON CONFLICT DO NOTHING` means the
   loser exits silently. 1h TTL.
2. `getRunService().create({ source: 'scheduled', taskDescription: task.prompt, trigger: { taskId }, threadId })`.
   `threadId` is `threadIdForRun(runId)` for `sessionMode: 'isolated'`, or the Claw's main thread for
   `sessionMode: 'main'` (OpenClaw's execution styles — isolated for reports, main for reminders that
   should remember they nagged you yesterday).
3. `executeRun({ runId, deps })` — **unchanged**. It is already source-agnostic. This is the entire
   reason cron is cheap here.
4. `finalizeScheduledTask(run)` — new `libs/claw-studio/src/gateway/scheduled-notifier.ts`, ported
   from nucleus: update `lastRun*` / `runCount` / `nextRunAt`, map status → outcome
   (`completed→result`, `failed|cancelled→failure`, `awaiting_*→attention`), deliver the digest.
   Never throws; every delivery attempt is recorded as a `notification` event on the run so a bad bot
   token is visible in the timeline instead of silent.

`SCHEDULED_SOURCE = 'scheduled'` joins `DASHBOARD_SOURCE` / `PLAYGROUND_SOURCE` in
`gateway/types.ts`. The dashboard's "Needs attention" and "Recent activity" zones pick up scheduled
failures with no change.

### 6.3 Approval policy — the per-task tool grant

`createClawGraph` deps gain:

```ts
approvalPolicy?: { mode: 'ask' | 'allowlist' | 'all'; allowedTools?: string[] };
```

`routeFromGenerateToTools` and `routeFromRevise` change from:

```ts
if (autoApprove) return 'tools';
const mutative = filterMutativeToolCalls(toolCalls);
```

to:

```ts
if (policy.mode === 'all') return 'tools';
const mutative = filterMutativeToolCalls(toolCalls)
  .filter((tc) => !granted.has(tc.name));
```

`autoApprove: true` maps to `mode: 'all'`, so **every existing caller keeps its exact behaviour** —
chat, playground, and gateway runs are untouched. Only scheduled runs pass `mode: 'allowlist'`.

### 6.4 Spend and failure guards

- `maxIterations` override per task (defaults to `BACKGROUND_MAX_ITERATIONS`).
- `failureStreak` increments on failure, resets on success. At 3, the task auto-pauses and notifies
  its delivery channel. Bounds a task that fails and retries daily forever.
- `CLAW_MAX_ACTIVE_TASKS_PER_TENANT` (25) enforced on create.
- `CLAW_MIN_INTERVAL_MINUTES` (15) floor on interval tasks and on cron expressions that resolve to a
  tighter cadence.

### 6.5 UI

**Nav:** `Cron Jobs` → `/cron` (matching the OpenClaw reference UI), and `Agent` → `/agent` for §4.

**`/cron` list** — shadcn `DataTable`: name, cadence (human label via `cronstrue`), next run, last run
+ `RunStatusBadge` (reuse), enabled `Switch`, row menu (Run now / Edit / Duplicate / Delete).

**Create/edit dialog** — shadcn `Form` + Zod:
- name, prompt textarea
- schedule: type toggle (cron / interval / once), cron picker (ported from nucleus
  `components/agent-ops/cron-picker.tsx`), timezone `Select`
- session mode toggle (isolated / main) with plain-language help text
- delivery: channel `Select` (Slack / Telegram / Discord / Jira / Email / none) + target field
- **Allowed without asking** section — see §6.6

**`/cron/[taskId]`** — task detail + run history table linking into the existing `/runs/[runId]`
timeline. No new timeline UI.

**"Schedule this" on `/chat`** — posts the thread to `POST /api/scheduled-tasks/distill`, which reuses
nucleus's distill prompt (verified: its rules are exactly right for unattended work — *keep concrete
identifiers verbatim, rewrite every time window as relative to run time, never ask a clarifying
question, state the no-op case explicitly*). Returns `{ name, prompt, suggestedCron, cadenceLabel,
suggestedTools }` and prefills the dialog. This is the chief-of-staff flow end to end: talk it
through, click Schedule, done.

### 6.6 Tool-grant UX

Only **mutative** tools are listed — reads never needed approval, so listing them is noise. Labels
come from the integration descriptors (`displayName` + tool description), grouped by integration,
with the raw tool name shown small.

```
── Allowed without asking ──────────────────────────
 Runs at 10:00 with nobody watching. Anything not
 listed here pauses the run and notifies you.

 Gmail          ☑ Send email        gmail_send_message
 Google Calendar ☐ Create event
                 ☐ Delete event
 Notion          ☐ Create page

 ○ Ask me for everything            (default)
 ● Allow only what's checked above
 ○ Allow everything  ⚠ unattended, no prompts
```

Pre-checked from `suggestedTools` when the task came from chat distillation — that pass already sees
the `TOOL_CALL` blocks in the transcript, so it knows the conversation used `gmail_send_message`. The
user reviews rather than assembles.

**Learn-on-block.** A run that hits an ungranted tool ends `awaiting_approval` and notifies the
channel — existing behaviour. The addition: a third button.

```
⏸ Daily Jira Report paused
   Wants to run: notion_create_page
   [Approve once] [Always allow for this task] [Reject]
```

"Always allow for this task" approves *and* appends to `allowedTools`. The task tightens itself over
the first week instead of requiring the list up front. Implemented as a new `ReplyAction`
(`'approve_always'`) in `gateway/types.ts`, handled in the notification router's action parsing for
Slack/Telegram/Discord.

`allowedTools` applies to **scheduled runs only**. A Slack-triggered run has a human right there, so
gating stays.

---

## 7. Part D — Jira

Nucleus's own docs (`docs/agent-ops/README.md:217`) draw the line explicitly, and we follow it
exactly:

> this is the **Jira gateway channel** (triggers runs from Jira Automation, posts results as issue
> comments — webhook + API token). It's separate from adding **Atlassian/Jira as an MCP tool source**
> (giving the agent read/write access to Jira issues via the Atlassian Rovo MCP server)

So Jira is **one thing to build and one thing to configure**:

| Need | How | Work |
|---|---|---|
| Trigger a run from Jira, reply as an issue comment, deliver scheduled digests | **Jira channel connector** — port nucleus's adapter | §7.1 |
| *Read the board* — JQL search, issue detail, sprints | **Atlassian Rovo MCP server**, added on the existing MCP Configuration page | §7.2 — no code |

### 7.1 Connector (port)

`libs/claw-studio/src/connectors/adapters/jira.ts`, from nucleus
`apps/web-ui/lib/gateway/adapters/jira-adapter.ts` (543 lines), conformed to our `ChannelConnector`
interface. Nucleus's adapter already implements the full shape — `validateRequest`, `parseInbound`,
`sendAck`, `sendResult`, `sendError`, `sendClarification`, `sendApprovalRequest`,
`sendScheduledNotification`, `getConfig` — including ADF (Atlassian Document Format) parsing for
comment bodies and mention stripping.

Notably it is the reference implementation for `sendScheduledNotification`, the method §6.2 needs
added to `ChannelAdapter` (as **optional**, so Slack/Telegram/Discord keep working untouched until
each is implemented).

Registration: `ConnectorRegistry` entry + `channel-fields.ts` + `channel-visuals.tsx`. `ChannelType`
already declares `'jira'`. The inbound route `app/api/gateway/[channel]/route.ts` is generic, so Jira
gets its webhook endpoint for free.

Tenant resolution follows the documented `ClawChannelLink` pattern: `externalId` = the Jira cloud id
or site hostname, captured when credentials are saved.

### 7.2 Reading the board — Atlassian Rovo MCP (no code)

**No hand-written `integrations/jira.ts`.** Nucleus reads Jira through the Atlassian Rovo MCP server,
and Claw Studio already supports MCP servers end to end: `ClawMcpServer` model, `createMcpTools()` in
`claw-runtime.ts`, and the MCP Configuration page. Adding the Rovo server there gives Claw
`searchJiraIssuesUsingJql`, `getJiraIssue`, and the rest with zero new code — confirmed against
nucleus's tool names in `tests/agent-ops/agent-shared.test.ts:321`.

Writing our own `jira_*` tools would duplicate a maintained upstream server, and duplicate the
credential surface the connector already owns.

Deliverables here are therefore **documentation, not code**:
- A docs page covering headless auth to the Rovo server (nucleus has one at
  `apps/web-ui/content/docs/jira-integration.mdx` to adapt).
- The MCP Configuration page gets a suggested-server hint for Atlassian Rovo so it is discoverable
  rather than folklore.

The mutative Rovo tools (`createJiraIssue`, `addCommentToJiraIssue`, …) flow through
`tool-classifier.ts` unchanged — `/\bcreate\b/i` and `/\badd\b/i`-style names classify as mutative, so
they appear in the §6.6 tool-grant picker like any other tool. Verify the actual served names during
implementation and add explicit entries to the picker's label map.

### 7.3 Excel caveat (documented, not fixed)

`google_drive_read_file` exports Google-native files (Docs/**Sheets**/Slides) as `text/plain`, so a
Google Sheet reads fine. A real `.xlsx` goes through `alt=media` and returns binary. Out of scope
here; recorded so the limitation is known rather than discovered in a demo.

---

## 7.4 Non-regression contract

The connectors and integrations all work today and **must keep working untouched**. This is a hard
constraint on the whole effort, not a nice-to-have.

**Files this effort must not modify:**
`libs/claw-studio/src/integrations/**` (all 8 integrations, the OAuth broker, providers, state),
`libs/claw-studio/src/connectors/adapters/{slack,telegram,discord}.ts`,
`libs/claw-studio/src/gateway/{gateway-service,notification-router,event-bus,run-service}.ts`,
`libs/claw-studio/src/memory/**`, `libs/claw-studio/src/skills/**`, `libs/claw-studio/src/mcp/**`.

**The only pre-existing files this effort touches, and the exact reason:**

| File | Change | Why it is safe |
|---|---|---|
| `agent/claw-graph.ts` | composed identity replaces the hardcoded string; `approvalPolicy` replaces the `autoApprove` boolean in two route functions | `autoApprove: true` maps to `mode: 'all'` and no files maps to `DEFAULT_IDENTITY` — both paths are byte-identical to today, pinned by regression tests |
| `agent/prompt-templates.ts` | `buildBaseIdentity` gains an optional second arg | Optional; existing single-arg call sites unchanged |
| `agent/claw-runtime.ts` | load workspace files; splice `file-tools` into `tools` | Additive, same shape as the existing `integrationTools` splice |
| `gateway/types.ts` | add `SCHEDULED_SOURCE`; add `'approve_always'` to `ReplyAction`; add **optional** `sendScheduledNotification?` to `ChannelAdapter` | All additive. Optional method means the three live adapters stay valid with no edit |
| `connectors/registry.ts` | register the Jira connector | One line, additive |
| `lib/nav-config.ts` (MC) | two new nav items | Additive |
| `prisma/schema.prisma` | four new models + two back-relations on `Claw` | Additive; no column changes to existing tables |

**Verification gate before merge:** full `bun run test` green, and specifically `nx test claw-studio`
— which already covers the integrations, connectors, gateway, memory, and skills — must show no new
failures against its pre-change baseline.

**Measured baseline, 2026-07-30, before any change in this effort:**

```
cd libs/claw-studio && bunx vitest run
→ Test Files  48 passed (48)
→ Tests      443 passed (443)
```

Every task in every plan below must keep all 443 green and only ever add to that count. Note the
known-red `bun run e2e:smoke` marketing/docs specs are pre-existing and unrelated to this work.

---

## 8. Data model

```prisma
model ClawFile {
  id        String   @id @default(cuid())
  tenantId  String
  clawId    String
  slug      String   // identity|soul|agents|user|tools|heartbeat
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

model ClawFileRevision {
  id          String   @id @default(cuid())
  tenantId    String
  fileId      String
  version     Int
  content     String   @db.Text
  updatedBy   String
  reason      String?  @db.Text   // Claw's stated reason when it wrote
  sourceRunId String?
  createdAt   DateTime @default(now())

  file ClawFile @relation(fields: [fileId], references: [id], onDelete: Cascade)

  @@unique([fileId, version])
  @@index([tenantId])
  @@map("claw_file_revisions")
}

// taskId is a globally unique random token, not a composite (tenantId, taskId):
// it travels in Slack/Telegram button payloads and dashboard URLs, so it must be
// unguessable and self-contained — same reasoning as ClawRun.runId.
model ClawScheduledTask {
  id              String    @id @default(cuid())
  tenantId        String
  clawId          String
  taskId          String    @unique
  name            String
  prompt          String    @db.Text
  scheduleType    String    @default("cron")     // cron|interval|once
  cronExpression  String    @default("")         // empty when not scheduleType=cron
  intervalMinutes Int?
  runAt           DateTime?                      // scheduleType=once
  timezone        String    @default("UTC")
  status          String    @default("active")   // active|paused|completed|deleted
  approvalMode    String    @default("ask")      // ask|allowlist|all
  allowedTools    String[]  @default([])
  sessionMode     String    @default("isolated") // isolated|main
  maxIterations   Int?
  providerModelId String?
  delivery        Json      @default("{}")       // { type, target }
  lastRunId       String?
  lastRunAt       DateTime?
  lastRunStatus   String?
  nextRunAt       DateTime?
  runCount        Int       @default(0)
  failureStreak   Int       @default(0)
  createdBy       String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  claw Claw @relation(fields: [clawId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([status])
  @@index([tenantId, status])
  @@map("claw_scheduled_tasks")
}

// ON CONFLICT on (taskId, scheduledAt) gives atomic lock acquisition.
model ClawScheduledTaskLock {
  id          String   @id @default(cuid())
  taskId      String
  scheduledAt String
  acquiredAt  DateTime @default(now())
  expiresAt   DateTime // 1h TTL

  @@unique([taskId, scheduledAt])
  @@index([expiresAt])
  @@map("claw_scheduled_task_locks")
}
```

`Claw` gains `files ClawFile[]` and `scheduledTasks ClawScheduledTask[]` back-relations.

---

## 9. API surface (mission-control)

All routes: Zod at the boundary, try/catch, Pino with `{ tenantId, clawId, taskId }`, tenant scoped
from the session.

```
GET    /api/files                                  list all six with metadata
GET    /api/files/[slug]                           read one
PUT    /api/files/[slug]                           write (creates a revision)
GET    /api/files/[slug]/revisions                 history
POST   /api/files/[slug]/revisions/[version]/restore

GET    /api/scheduled-tasks                        list
POST   /api/scheduled-tasks                        create
GET    /api/scheduled-tasks/[taskId]
PATCH  /api/scheduled-tasks/[taskId]               edit / pause / resume
DELETE /api/scheduled-tasks/[taskId]
POST   /api/scheduled-tasks/[taskId]/trigger       run now
GET    /api/scheduled-tasks/[taskId]/runs          run history
POST   /api/scheduled-tasks/distill                transcript → task draft

GET/PUT /api/connectors/jira                       via existing generic [channel] routes
POST    /api/gateway/jira                          via existing generic [channel] route
```

No Jira integration routes — board reading is an MCP server, configured through the existing
`/api/mcp-servers` routes (§7.2).

---

## 10. Standards

Inherited root standards apply without exception: Zod on every form and route boundary, T3 Env for
all new vars, shadcn/ui only, try/catch everywhere with Pino structured logging, no direct
`process.env`, no plaintext credentials (Jira `apiToken` through the existing encryption service).

**New deps:** `croner`, `cronstrue`.

**New env** (all via `libs/claw-studio/src/env.ts` / mission-control `lib/env.ts`):

| Var | Default | Purpose |
|---|---|---|
| `CLAW_SELF_AUTHORING` | `user` | `off` \| `user` \| `all` |
| `CLAW_WORKSPACE_MAX_CHARS` | `16000` | total composed cap |
| `CLAW_SCHEDULER_SWEEP_MS` | `30000` | sweep interval |
| `CLAW_MAX_ACTIVE_TASKS_PER_TENANT` | `25` | create-time guard |
| `CLAW_MIN_INTERVAL_MINUTES` | `15` | cadence floor |

---

## 11. Testing

**Vitest, colocated in `libs/claw-studio`:**
- `prompt-composer.test.ts` — section order, omission of empty files, per-file and total truncation
  with markers, surface gating (`tools` only on acting, `heartbeat` only on scheduled)
- `prompt-templates.test.ts` — extend: composed identity wins, `DEFAULT_IDENTITY` fallback when no
  files, skill branch still overrides
- `claw-graph.test.ts` — extend: `approvalPolicy` routing for all three modes; `autoApprove: true`
  still behaves exactly as `mode: 'all'` (regression guard for existing callers)
- `file-tools.test.ts` — per-slug policy, `edit` ambiguity error, per-run write cap, revision written
  with reason, `CLAW_SELF_AUTHORING` kill-switch
- `workspace-file-service.test.ts` — seeding idempotency, version increment, restore
- `scheduled-task-service.test.ts` — CRUD, cadence floor, per-tenant cap, `failureStreak` auto-pause
- `select-due-tasks.test.ts` — cron/interval/once selection, timezone, malformed cron skipped
- `scheduled-notifier.test.ts` — status→outcome mapping, delivery failure recorded as an event, never
  throws
- `connectors/adapters/jira.test.ts` — ported from nucleus's `jira-adapter.test.ts` (107 lines),
  following the existing `discord.test.ts` pattern. No integration-tool tests: §7.2 is MCP + docs

**Worker:** `apps/workers/src/jobs/claw-scheduler/index.test.ts` — sweep enqueues due ticks only,
`sweepInFlight` guard, lock contention exits silently, tick creates a run with `source: 'scheduled'`.

**Playwright** — `@claw-studio` tag: edit SOUL → save → verify persisted + a revision exists →
restore; create a scheduled task → run now → run appears in `/runs` with `source: scheduled`.

> **Harness gap found during planning.** The e2e project has a single `baseURL` on port **3005**
> (web-ui), one `chromium` project, and one `webServer`. Mission Control runs on **3010** with its
> **own** NextAuth Credentials login and its own `NEXTAUTH_SECRET` — `apps/mission-control/middleware.ts`
> states plainly that it *"does not trust web-ui's session"*. So these journeys are currently
> **unreachable** by the existing harness, and the one existing spec
> (`modules/claw-studio/provision.spec.ts`) only covers web-ui's provisioning card.
>
> Covering them therefore needs new harness wiring: a second Playwright project with
> `baseURL: MISSION_CONTROL_URL`, its own setup project minting a studio session JWT
> (`{ studioId, tenantId, clawId }` under `session.studio`), and `testIgnore` on the existing
> `chromium` project so MC specs don't also run against 3005. That is Plan D5 (§12), sequenced last
> because it needs `/agent` and `/cron` to exist.

---

## 12. Phasing

| Phase | Content | Status |
|---|---|---|
| **1** | Workspace files: models, `WorkspaceFileService`, `prompt-composer`, `systemPrompt` shadowing fix, seeding, `/agent` Files UI with tabs + preview + revision diff/restore | this effort |
| **2** | Self-authoring: `file-tools`, per-slug policy, write cap, kill-switch, revision audit | this effort |
| **3** | Cron: models, sweeper worker, `scheduled` source, `approvalPolicy`, scheduled-notifier, `/cron` UI, cron-picker, distillation, scheduling tools, tool-grant UX + `approve_always` | this effort |
| **4** | Jira: connector port + settings UI + Rovo MCP docs (no `jira_*` tools — §7.2) | this effort |
| **5** | Generic webhook trigger — per-Claw URL + HMAC secret, payload templated into a prompt | deferred |
| **6** | Inbound email trigger — **decided mechanism: poll the connected Gmail/Outlook account** on a cadence, reusing existing OAuth tokens. Zero new infra, covers both providers. (Gmail Pub/Sub rejected: GCP project + topic + 7-day watch renewal, Gmail-only. SES inbound rejected: MX/Pulumi surface.) | deferred |
| **7** | Heartbeat + dreaming — idle consolidation sweep over `ClawMemory` (stage → theme → promote), reviewable diary | deferred |
| **8** | Multiple named agents — relax the `claw-service` guard, agent switcher, per-agent isolation audit | deferred |

### Phase 8 detail — what multi-agent changes about Scheduled Tasks

Recorded now because the single-agent build must not foreclose it. **Today Claw Studio is
single-agent**; everything below is future work, not current scope.

Both references split scheduling the same way, and we should too:

| Surface | Scope | Status |
|---|---|---|
| **Scheduled Tasks** (sidebar, top level) | Every task across every agent — the nucleus `/agent-ops/scheduled-tasks` page | **built now** |
| **Cron Jobs** tab on `/agent` | Only the selected agent's tasks — the OpenClaw `Agents → Cron Jobs` tab | **Phase 8** |

OpenClaw's per-agent tab pairs an *Agent Context* card (workspace, primary model, identity, skills
filter) with a *Scheduler* card (enabled, job count, next wake) and an *Agent Cron Jobs* list.

What already supports this, so Phase 8 is additive rather than a migration:

- `ClawScheduledTask.clawId` is a real FK from day one — per-agent filtering is a `where` clause.
- The `/agent` page is already a tab shell (`Overview | Files | Tools`); the Cron tab slots in beside
  them.
- `/scheduled-tasks` lists by `tenantId`, so it keeps working unchanged once several agents exist.

The only Phase 8 work here is the tab itself, an agent column/filter on the global list, and an agent
picker in the create dialog.

Phases 1–4 are this effort. Plus a fifth for test coverage, because §11's journeys need new harness
wiring before they can be written at all.

| Plan | File | Tasks |
|---|---|---|
| D1 — Workspace files | `plans/2026-07-30-claw-plan-d1-workspace-files.md` | 10 |
| D2 — Self-authoring | `plans/2026-07-30-claw-plan-d2-self-authoring.md` | 6 |
| D3 — Scheduled tasks | `plans/2026-07-30-claw-plan-d3-scheduled-tasks.md` | 11 |
| D4 — Jira connector | `plans/2026-07-30-claw-plan-d4-jira-connector.md` | 6 |
| D5 — E2E coverage | `plans/2026-07-30-claw-plan-d5-e2e-coverage.md` | 4 |

**Order matters.** D2 depends on D1's `WorkspaceFileService`. D3 generalises D2's `grantedTools` into
`approvalPolicy` and uses D1's `scheduled` prompt surface for `HEARTBEAT`. D4 needs D3's optional
`sendScheduledNotification`. D5 needs D1's `/agent` and D3's `/cron` pages to exist.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Self-edited soul drifts or degrades the persona | Revisions + diff + one-click restore; `soul`/`agents` approval-gated; `CLAW_SELF_AUTHORING` defaults to `user` only |
| Composed prompt regresses existing chat quality | `DEFAULT_IDENTITY` fallback means a tenant with no files is byte-identical to today; seeds are short; total char cap |
| Unattended mutation via granted tools | Least-privilege `allowedTools`, default `ask`; `allow everything` labelled as unattended; learn-on-block so grants stay minimal |
| Runaway token spend on a cadence | Per-task `maxIterations`, `failureStreak` auto-pause at 3, per-tenant active-task cap, cadence floor |
| Cron correctness / DST | `croner` with per-task timezone; `selectDueTasks` ported with its existing tests; 60s due window + `singletonSeconds` dedupe |
| Disturbing working connectors/integrations | Additive only. `sendScheduledNotification` added as **optional**. `approvalPolicy` maps `autoApprove: true` → `mode: 'all'`, a regression test pins this. No edits to `integrations/`, `oauth-*`, or existing adapters |
| Two sources of truth for memory | D4 — no `MEMORY.md` |

---

## 14. Out of scope

Multi-agent (§12.8). Generic webhooks (§12.5). Inbound email (§12.6). Dreaming (§12.7). `.xlsx`
parsing (§7.3). `MEMORY.md` (D4). `BOOT.md` / `BOOTSTRAP.md` / `canvas/` (D10). Hand-written `jira_*`
integration tools (§7.2 — the Atlassian Rovo MCP server covers this).

# Claw Studio — Design Spec

**Date:** 2026-07-15
**Branch:** `feature/claw-studio`
**Status:** Approved design → ready for implementation plan

---

## 1. Summary

Claw Studio is a new, self-contained module for the multi-tenant chatbot platform. It introduces **Claw** — a single, persistent, autonomous AI teammate per Studio — and **Mission Control**, a separate web console (its own app, its own login) where users chat with Claw and manage its capabilities.

It sits alongside the existing **Agent Studio**, and the product line between them is deliberate:

> **Agent Studio** = you *build* many agent workflow graphs.
> **Claw Studio** = you *operate* one persistent autonomous teammate.

The module reuses a proven, architecturally near-identical reference implementation (`nucleus-cloud-ops@master-v1`, its "Agent Ops" runtime) rather than building the agent runtime from scratch.

---

## 2. Core concepts

- **Studio** — the container/workspace that holds credentials, memory, skills, MCP config, and connectors. Provisioned by a tenant admin.
- **Claw** — the single autonomous agent that lives inside a Studio. One identity, one accumulating memory, one set of skills/tools/connectors. It is the "teammate" you chat with in Mission Control.
- **Mission Control** — the separate console app for operating Claw.

### Scope & multiplicity decisions

- **Phase 1: one Studio per tenant, one Claw per Studio.**
- **Built for many, gated in app logic.** The relational shape is `Tenant ──< ClawStudio ──< Claw ──< { Memory, Skills, MCP, Connectors }`. The "one" at each level is enforced in application code, **never** as an irreversible DB constraint. Growing to multiple named Claws later is a guard-removal + a list/switcher UI + per-Claw isolation — not a migration.
- **SaaS trajectory:** multiple named Claws is the eventual model (it is the natural pricing/segmentation axis and the data-isolation boundary customers need). We ship one first to validate the spine cheaply, without foreclosing the upgrade. When multiple ships, Claws are **named** ("Ada", "Support Claw"), not auto-numbered.

---

## 3. Architecture

### 3.1 Module topology

```
apps/
  web-ui/                              # existing app — hosts the provisioning entry only
    app/(dashboard)/claw-studio/       # NEW: the "Claw" card → Generate/Reset Studio ID+Password → Mission Control launch
    app/api/claw-studio/               # NEW: provision / reset-password / resolve launch URL
  mission-control/                     # NEW separate Next.js app (own login, own port/deploy)
    app/(auth)/login/                  #   MC login — authenticates Studio ID + Password
    app/(console)/                     #   console shell + sidebar sections
    app/api/copilotkit/                #   CopilotKit Runtime endpoint → Claw graph
libs/
  claw-studio/                         # NEW lib — Claw's brain + services (mirrors libs/agent-studio)
    src/agent/                         #   LangGraph executor-graph, state, prompts, model-factory
    src/memory/                        #   memory service, reconcile, episode, procedural, skill-synthesis
    src/mcp/                           #   MCP manager, config, tool wrapping
    src/services/                      #   studio-service, claw-service, skill-service, memory-service
    src/types/
    CLAUDE.md                          #   module CLAUDE.md (see §9)
prisma/schema.prisma                   # NEW models (see §4)
```

**Rule:** the heavy dependencies (`@copilotkit/*`, `@langchain/*`, `@langchain/langgraph`, `deepagents` if adopted) live in `apps/mission-control` and `libs/claw-studio` **only** — never in `web-ui`. This protects web-ui's known-fragile build (Nx `run-commands`, `serverExternalPackages`).

### 3.2 Chosen approach (from brainstorming)

- **Separate Nx app + shared core lib**, JS-native LangGraph. (Not a route group in web-ui; not a separate Python service.)
- **Mission Control has its own login.** The Studio ID/Password are the credentials for that separate app, decoupled from web-ui's NextAuth session — usable from any device.
- **Claw's brain = the reference's "Agent Ops" executor-graph** (production lineage), adapted to conversational turns. Not the experimental `deepagents` surface (kept as a documented future option).
- **Chat layer = CopilotKit from day one** (CopilotKit Runtime + its LangGraph integration), with the executor-graph underneath.

---

## 4. Data model (`prisma/schema.prisma`)

All models tenant-scoped. Credentials never stored in plaintext. "One-per" invariants enforced in service code, not via DB unique constraints that would block multiplicity later.

| Model | Key fields | Notes |
|---|---|---|
| `ClawStudio` | `id`, `tenantId`, `studioId` (public login id, unique), `passwordHash` (bcrypt), `status`, `lastLoginAt`, `createdAt` | **No `@unique` on `tenantId`** — keeps multi-Studio open. One-per-tenant enforced in `studio-service`. |
| `Claw` | `id`, `studioId` → FK, `name`, `systemPrompt`/persona, `providerModelId` (reuses agent-studio's existing `LlmProvider`), `autoApprove`, `settings` | One-per-Studio enforced in `claw-service`. |
| `ClawConversation` | `id`, `clawId`, `threadId` (LangGraph checkpoint key), `title`, `createdAt` | Thread registry for the chat UI. |
| _LangGraph checkpoint tables_ | (managed by `@langchain/langgraph-checkpoint-postgres`) | **Postgres checkpointer — no MongoDB.** The executor-graph uses Postgres, keeping this a single-datastore module. |
| `ClawMemory` | `namespace` (per-claw), `key`, `value` (json), `kind` (`SEMANTIC`\|`EPISODIC`\|`PROCEDURAL`), `embedding vector(1024)`, supersede chain, `ttl` | Mirrors reference `AgentMemory`. pgvector. |
| `ClawWorkingMemory` | per-thread rolling summary + scratchpad | Durable mirror of the checkpoint. |
| `ClawSkill` | `slug`, `name`, `description`, `tier` (`read-only`\|`mutation`\|`approval-gated`), `content` (md), `source` (`user`\|`system`), `isEnabled` | Mirrors reference `Skill`. |
| `ClawMcpServer` | transport, command/url, env (encrypted), `isEnabled`, tenant/claw scope | MCP server config. |

---

## 5. Provisioning + auth flow

### 5.1 Provisioning (in web-ui)

1. **`/claw-studio`** dashboard page shows the "Claw" card.
2. No Studio for tenant → **Generate Studio** → `POST /api/claw-studio/provision`:
   - creates `ClawStudio` with a generated `studioId` and a strong generated password (shown to the user **once**; only the bcrypt hash is stored),
   - creates the single `Claw`.
3. **Reset Password** → regenerates the password, re-hashes, reveals once.
4. Once provisioned, a **Mission Control** button opens the MC app in a new tab (`?studio=<studioId>` to prefill the login).

### 5.2 Mission Control login (in mission-control app)

- Its own **NextAuth v4 Credentials provider**: validates `studioId` + password via `bcrypt.compare` against `ClawStudio.passwordHash`.
- Own `NEXTAUTH_SECRET` / cookie. Session JWT carries `{ studioId, tenantId, clawId }`.
- Middleware guards `(console)` routes and scopes **all** Claw data by the session's `tenantId`.
- Fully decoupled from web-ui's session (matches "feels like a totally new web app").

---

## 6. Mission Control console

shadcn/ui sidebar, data-driven (like the reference's `nav-config.ts`). Sections:

| Section | Phase 1 |
|---|---|
| **Mission Dashboard** | Shell + real data (Claw status, recent conversations/activity) |
| **Chat with Claw** | Full (CopilotKit) |
| **Skills Runtimes** | Runtime live (graph loads skills); management screen = Phase 1.x |
| **Memory Runtimes** | Runtime live (graph recalls/writes); management screen = Phase 1.x |
| **MCP Configuration** | Runtime live (tools bound); management screen = Phase 1.x |
| **Connectors** | Phase 2 (gateway adapters) |

Skills/memory/MCP are **not deferred** as runtime capabilities — they are structural nodes/bindings in the graph (see §7). Only their dedicated *management UIs* are fast-follow.

---

## 7. Chat-with-Claw runtime (CopilotKit ↔ Claw graph)

```
CopilotKit <CopilotChat> / useCoAgent        (mission-control (console)/chat)
        │
        ▼  app/api/copilotkit/route.ts        (CopilotKit Runtime)
        │
        ▼  LangGraph integration → Claw graph (libs/claw-studio/src/agent)
        │
  memory_recall → evaluator(skill-select) → planner → [approval_gate]
        → generate ⇄ tools (MCP + memory) ⇄ reflect → revise → final → memory_save
        │
   model via model-factory → tenant LlmProvider      Postgres checkpointer keyed by threadId
```

### How capabilities are fused (from the reference runtime)

- **Memory recall** is the **first graph node**: pgvector semantic search across SEMANTIC/EPISODIC/PROCEDURAL, injected into downstream prompts. SEMANTIC facts pass an LLM relevance filter; PROCEDURAL/EPISODIC are distance-gated.
- **Memory save** is the **terminal node**: an LLM extracts facts/rules; `reconcile` decides add/update/supersede/reinforce; episodes captured; then **skill synthesis** distills matured procedural memory into new `system` skills.
- **Skills** load at graph build; the evaluator node selects one; its `SKILL.md`/content is injected into the system prompt. `save_memory`/`search_memory` also bound as mid-run tools.
- **MCP tools** assembled and `bindTools`'d into the same graph per run.
- **HITL** via LangGraph `interruptBefore` on approval gates (plan approval + mutative-tool approval, classified by a tool-classifier); resumed via `Command`/`updateState`.

### CopilotKit integration risk (implementation step #1 = a spike)

The reference drives its UI from a DB-polled `AgentOpsEvent` taxonomy, not CopilotKit. The first implementation step is a **de-risking spike** proving CopilotKit ↔ this LangGraph graph:
- map the graph's interrupt-based HITL onto CopilotKit's HITL model,
- reproduce the event taxonomy (memory recall/save, tool call+result, thinking, evaluation, approval) as CopilotKit generative-UI renderings,
- confirm streaming of node/state updates through the CopilotKit Runtime.

If the spike surfaces blocking friction, the fallback is the reference's proven SSE-stream + Vercel AI SDK transport, with CopilotKit layered later — but the committed target is CopilotKit.

---

## 8. Reuse map (adapt from `nucleus-cloud-ops@master-v1`)

Source repo: `/Users/H2702/.superset/projects/nucleus-cloud-ops` (branch `master-v1`, read-only reference). Paths below are in that repo, adapted into `libs/claw-studio`.

| Target area | Reference source |
|---|---|
| Graph / state / prompts | `lib/agent-ops/{executor-graphs,executor-state,tool-classifier,run-manager}.ts`, `lib/agent/memory-nodes.ts`, `lib/agent/prompt-templates.ts` |
| Memory | `lib/agent/memory/{memory-service,reconcile,episode,procedural,skill-synthesis}.ts`, `lib/agent-memory/{category,promote}.ts` |
| Model layer | `lib/agent/{model-factory,model-resolver,embeddings-factory}.ts` → **bridged to this repo's existing `LlmProvider`** (agent-studio) |
| MCP | `lib/agent/{mcp-manager,mcp-config,mcp-tools}.ts` |
| Connectors (Phase 2) | `lib/gateway/*` (adapter-registry + slack/jira/discord/telegram/webhook adapters) |
| Persistence | `lib/agent/persistence.ts` (Postgres checkpointer + store) |
| Credentials | **use this repo's existing `libs/shared/src/services/encryption-service.ts`** (not the reference's `provider-credentials.ts`); bcrypt for the studio login |
| Console shell | `lib/nav-config.ts`, `components/layout/app-sidebar.tsx` |

---

## 9. Module CLAUDE.md (to be created at `libs/claw-studio/CLAUDE.md` during implementation)

The module CLAUDE.md must document:

- **Purpose & product line:** Claw = one persistent autonomous teammate per Studio; distinct from Agent Studio (build many workflows vs operate one teammate).
- **The Studio/Claw model:** one Studio per tenant, one Claw per Studio in Phase 1; built for many, gated in app logic; multiplicity roadmap.
- **Architecture:** separate `apps/mission-control` app + `libs/claw-studio` core lib; separate login (Studio ID/Password); heavy deps kept out of web-ui.
- **Tech stack (mandatory to record):** **LangGraph, LangChain, CopilotKit, Vercel AI SDK**, pgvector-backed memory, Postgres LangGraph checkpointer, `deepagents` documented as a future orchestration option.
- **The graph:** node-by-node responsibilities (`memory_recall → evaluator/skill-select → planner → approval → generate ⇄ tools ⇄ reflect → revise → final → memory_save`).
- **Reuse provenance:** copied/adapted from `nucleus-cloud-ops@master-v1`, with the §8 path table.
- **Commands & ports:** MC dev port, `nx test claw-studio`, build.
- **Standards:** inherited root standards (Zod, T3 env, shadcn/ui, try/catch + Pino, no direct `process.env`) + module specifics.
- **Phase roadmap** (see §11).

> Note: the actual `libs/claw-studio/CLAUDE.md` file is created as the first documentation task in the implementation plan (creating it now would scaffold the module before the plan is approved). Its content is fully specified here.

---

## 10. Standards & testing

Per the project's mandatory standards:

- **Validation:** Zod at every MC form and every API route boundary (`/api/claw-studio/*`, `/api/copilotkit`, MC console APIs).
- **Env:** all new env vars via **T3 Env** — e.g. `MISSION_CONTROL_URL` (web-ui, for the launch button), MC `NEXTAUTH_SECRET`, MC `NEXTAUTH_URL`. No direct `process.env`.
- **UI:** shadcn/ui components only.
- **Error handling:** try/catch in every route handler, service method, and graph node; log then re-throw or return a typed error.
- **Logging:** Pino with structured context `{ tenantId, studioId, clawId, threadId }`.
- **Credentials:** bcrypt for the studio login password; existing `encryption-service` for any stored provider/MCP secrets.
- **Testing:**
  - Vitest colocated in `libs/claw-studio` (graph nodes, memory recall/save + reconcile, skill loading/synthesis, `studio-service` provisioning + password reset). `nx test claw-studio` target.
  - Playwright module `apps/web-ui-e2e/modules/claw-studio/` (+ a `@claw-studio` tag) covering provision → launch → MC login → chat-with-Claw.

---

## 11. Phasing

- **Phase 1 (spine + runtime):** provisioning → MC login → dashboard shell → **working Chat-with-Claw** with memory + skills + MCP live in the graph. First step is the CopilotKit↔graph spike (§7).
- **Phase 1.x (fast-follow):** the Skills / Memory / MCP management screens, lifted and reskinned from the reference.
- **Phase 2+:** Connectors (gateway adapters), multiple **named** Claws (relax the app-logic guard + list/switcher + per-Claw isolation), scheduled/triggered autonomous runs.

---

## 12. Open questions / risks

- **CopilotKit ↔ executor-graph fit** — the primary risk; addressed by the spike (§7).
- **LangChain/LangGraph versions** — the reference uses `@langchain/langgraph@1.2`, `langchain@1.2`. Pin compatible versions in `libs/claw-studio`; confirm no clash with web-ui's `ai@6` / `@ai-sdk/*`.
- **Memory embeddings** — reference uses Bedrock Titan v2 (1024-dim). Confirm the tenant's embedding provider is available; reuse the existing embeddings path where possible. (Related deferred KB work exists — keep embedding-dimension assumptions explicit.)
- **Deploy target** — `apps/mission-control` needs its own build + deploy wiring (Nx `run-commands`, standalone output), mirroring web-ui. Infra (Pulumi) changes are Phase 1 tail work.

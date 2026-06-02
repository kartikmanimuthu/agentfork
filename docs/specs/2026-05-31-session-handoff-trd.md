# Session Handoff — Technical Requirements / Design Document (TRD)

**Feature:** Session Handoff (Human Escalation)
**Version:** 0.1 (Draft — for later revision)
**Status:** Draft
**Author:** Kartik Manimuthu + Claude
**Date:** 2026-05-31
**PRD Reference:** `docs/product/PRD-Session-Handoff.md`

---

## 0. Purpose & Scope

This document is the engineering counterpart to the Session Handoff PRD. It specifies the data model, control flow, integration points, APIs, and infrastructure required to escalate a live AI conversation to a human — either to an **external agent-desk via webhook** or to a **built-in in-app live-chat surface**.

All references to existing code use real paths and line numbers as of commit `1ae9f1f` on branch `session-handoff`. Where this TRD proposes additions, it follows the conventions already in the repo (string-valued status fields rather than Prisma enums, `cuid()` IDs, `@@map()` to snake_case, tenant-scoped composite indexes, class-based services with injected Prisma client, Zod validation at boundaries, Pino structured logging, T3 Env for config).

This TRD is **comprehensive across all phases**. Build sequencing is in [§15](#15-phased-implementation-plan); Phase 1 (external, fire-and-forget) is the only part that ships without new realtime infrastructure.

---

## 1. System Architecture

### 1.1 Component Map

```
                          ┌─────────────────────────────────────────────┐
                          │              Inference Path                  │
   widget / API / WA ───▶ │  apps/web-ui/app/api/v1/inference/route.ts   │
                          │                                              │
                          │   ┌──────────────────────────────────────┐  │
                          │   │  TriggerEngine.evaluate(turn,session)  │ │  ◀── NEW (inference-time)
                          │   │  T1 explicit · T2 AI-tool · T3 retr.  │  │
                          │   │  T4 loop · T5 sentiment · T6 rules    │  │
                          │   └───────────────┬──────────────────────┘  │
                          └───────────────────┼─────────────────────────┘
                                              │ trigger fires → HandoffService.request()
                                              ▼
                    ┌──────────────────────────────────────────────────────┐
                    │                 HandoffService  (NEW)                  │
                    │  creates Handoff row · generates summary · audits      │
                    └───────────────────────────┬───────────────────────────┘
                                                 │
                                                 ▼
                    ┌──────────────────────────────────────────────────────┐
                    │                 HandoffRouter  (NEW)                   │
                    │  reads tenant config → selects destination adapter     │
                    └───────────┬───────────────────────────┬───────────────┘
                                │                            │
                ┌───────────────▼─────────┐      ┌───────────▼──────────────┐
                │  ExternalWebhookAdapter  │      │   BuiltinQueueAdapter     │
                │  (uses WebhookService)   │      │   (enqueue → Agent Inbox) │
                └───────────┬─────────────┘      └───────────┬───────────────┘
                            │                                │
                ┌───────────▼─────────┐          ┌───────────▼──────────────┐
                │  pg-boss job:        │          │  Realtime transport       │  ◀── NEW infra
                │  handoff-webhook-    │          │  (SSE / WS / poll — §6)   │
                │  delivery (retry)    │          │  Operator Inbox UI         │
                └──────────────────────┘          └────────────────────────────┘

   Cross-cutting (NEW + reused):
     • Prisma models: Handoff, HandoffEvent, HandoffMessage, Operator(presence)  (NEW)
     • TenantConfig key "handoffConfig"  (reuses TenantConfigService)
     • AuditLog via AuditService  • pg-boss via boss.ts  • EmailService fallback
     • RBAC: new "LiveChat" module + operator capability
```

### 1.2 Design Principles

1. **Inference path stays fast and non-blocking.** Trigger evaluation is synchronous but cheap; all side effects (webhook delivery, summary-on-handoff if expensive, notifications) are enqueued to pg-boss. Hard budget: ≤150ms p95 added (excluding an optional T2 LLM tool round-trip, which is part of the model turn itself).
2. **Routing is an interface, not a branch.** `HandoffRouter` resolves to a `HandoffDestinationAdapter`. External and built-in are two implementations; adding a third (e.g. Slack) is a new adapter, not a rewrite.
3. **Durable lifecycle.** The `Handoff` row is the source of truth. Every transition writes a `HandoffEvent`. Restarts never lose a handoff.
4. **Off by default.** No tenant sees behavior change until `handoffConfig.enabled = true`. The trigger engine short-circuits to a no-op when disabled.
5. **Channel-aware.** The router and adapters receive the channel and respect its constraints (esp. WhatsApp's 24h window via existing `WhatsAppSession.windowExpiresAt`).

---

## 2. Data Model

New Prisma models, written to match existing conventions (see `prisma/schema.prisma:498–572` for the `InferenceSession` family they attach to). Status fields are **strings with defaults**, mirroring `InferenceSession.status String @default("active")` (`schema.prisma:507`) — the codebase does not use Prisma enums for these.

### 2.1 `Handoff` — the lifecycle root

```prisma
model Handoff {
  id             String    @id @default(cuid())
  tenantId       String
  sessionId      String    @unique          // 1:1 with the live InferenceSession at a time
  agentId        String
  channel        String                      // mirrors InferenceSession.channel (API/SDK/WhatsApp)
  routingMode    String                      // "external" | "builtin"
  status         String    @default("requested")
  // lifecycle: requested → routed|queued → accepted|assigned → active → resolved
  //            | returned_to_bot | closed | fallback_* | failed
  triggerSignals Json                        // [{signal:"T2", score, reason, firedAt}]
  triggerReason  String?   @db.Text          // human-readable primary reason
  summary        String?   @db.Text          // AI summary generated at handoff time
  priority       Int       @default(0)       // for inbox ordering / future skills routing
  category       String?                     // best-effort intent classification
  contact        Json?                       // {email?, phone?, name?} captured for fallback/identity
  operatorId     String?                     // assigned operator (builtin mode)
  externalRef    String?                     // external system's conversation/ticket id (external mode)
  queuedAt       DateTime?
  assignedAt     DateTime?
  firstResponseAt DateTime?                   // for time-to-agent metric
  resolvedAt     DateTime?
  resolution     String?                     // "resolved" | "unresolved" | "returned" | "abandoned"
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  tenant   Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  session  InferenceSession  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  operator Operator?         @relation(fields: [operatorId], references: [id], onDelete: SetNull)
  events   HandoffEvent[]
  messages HandoffMessage[]

  @@index([tenantId, status])
  @@index([tenantId, channel, status])
  @@index([tenantId, operatorId, status])
  @@index([status, queuedAt])               // inbox queue ordering
  @@map("handoffs")
}
```

> **Schema touch-point:** add `handoff Handoff?` to `InferenceSession`'s relation block (`schema.prisma:514–522`) and `handoffs Handoff[]` to `Tenant` (`schema.prisma:13–38`).

### 2.2 `HandoffEvent` — append-only transition log

```prisma
model HandoffEvent {
  id        String   @id @default(cuid())
  handoffId String
  tenantId  String
  type      String                      // "requested","routed","queued","assigned","message",
                                         // "resolved","returned_to_bot","fallback","webhook_delivered",
                                         // "webhook_failed","operator_joined","timeout"
  actor     String                      // "system" | "ai" | "operator:<id>" | "user" | "external"
  data      Json?
  createdAt DateTime @default(now())

  handoff Handoff @relation(fields: [handoffId], references: [id], onDelete: Cascade)

  @@index([handoffId, createdAt])
  @@index([tenantId, type])
  @@map("handoff_events")
}
```

Drives the analytics funnel and the audit timeline. Every state transition in §5 writes one row.

### 2.3 `HandoffMessage` — human/operator turns

Operator and external-relayed messages are stored **distinctly** from AI/user turns. We do *not* overload `InferenceSessionMessage` (`schema.prisma:532–548`) with operator content, because its `role` is constrained to `user`/`assistant` and it carries an embedding column meant for AI turns. Instead:

```prisma
model HandoffMessage {
  id         String   @id @default(cuid())
  handoffId  String
  tenantId   String
  sender     String                      // "operator" | "user" | "external" | "system"
  operatorId String?
  content    String   @db.Text
  attachments Json?   @default("[]")
  deliveredAt DateTime?                   // for delivery-confirmation on async channels
  createdAt  DateTime @default(now())

  handoff  Handoff   @relation(fields: [handoffId], references: [id], onDelete: Cascade)
  operator Operator? @relation(fields: [operatorId], references: [id], onDelete: SetNull)

  @@index([handoffId, createdAt])
  @@map("handoff_messages")
}
```

A unified transcript view is the time-ordered merge of `InferenceSessionMessage` (AI/user, pre-handoff) + `HandoffMessage` (human, post-handoff). Reads use `createdAt` ordering across both.

### 2.4 `Operator` — built-in human agent presence

Decision (open question #4 in PRD): operators are **existing platform `AuthUser`s** with an added capability, plus a lightweight presence row — not a separate identity system. This reuses auth/session/RBAC.

```prisma
model Operator {
  id              String   @id @default(cuid())
  tenantId        String
  userId          String                      // FK to AuthUser
  status          String   @default("offline") // "online" | "away" | "offline"
  maxConcurrent   Int      @default(3)
  activeCount     Int      @default(0)         // denormalized; maintained transactionally
  lastSeenAt      DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  tenant   Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user     AuthUser         @relation(fields: [userId], references: [id], onDelete: Cascade)
  handoffs Handoff[]
  messages HandoffMessage[]

  @@unique([tenantId, userId])
  @@index([tenantId, status])
  @@map("operators")
}
```

### 2.5 Configuration — `TenantConfig` key, not a new table

Handoff settings live under `TenantConfig` with `configKey = "handoffConfig"`, read/written via the existing `TenantConfigService` (`libs/shared/src/services/tenant-config-service.ts`). Shape (validated by Zod, see §10):

```jsonc
{
  "enabled": true,
  "routing": { "mode": "external", "perChannel": { "WhatsApp": "external", "SDK": "builtin" } },
  "triggers": {
    "explicit":   { "enabled": true,  "force": true },                 // T1
    "aiTool":     { "enabled": true,  "force": true },                 // T2
    "retrieval":  { "enabled": false, "minTopScore": 0.45 },           // T3
    "loop":       { "enabled": false, "maxRepeats": 3 },               // T4
    "sentiment":  { "enabled": false, "frustrationThreshold": 0.7 },   // T5
    "rules":      { "enabled": true,  "patterns": ["refund","legal","cancel my account"] }, // T6
    "policy":     { "escalationThreshold": 0.6, "cooldownTurns": 4, "maxPerSession": 2 }
  },
  "external": {
    "webhookUrl": "https://desk.tenant.com/handoff",
    "webhookSecretRef": "<encrypted-ref>",      // via EncryptionService
    "depth": "fire_and_forget"                  // | "bidirectional"
  },
  "businessHours": { "tz": "Asia/Kolkata", "schedule": [...], "outsideHoursBehavior": "capture_email" },
  "fallback": ["queue", "capture_email", "create_ticket", "graceful_close"],
  "operator": { "autoAssign": false, "maxQueueWait": 120 },
  "messages": { "connecting": "Connecting you to our team…", "queued": "You're #{pos} in line", "offHours": "We're offline; leave your email." }
}
```

`webhookSecretRef` holds an `EncryptionService`-encrypted secret (`libs/shared/src/services/encryption-service.ts`), matching how other credentials are stored.

---

## 3. Trigger Engine (Inference-Time)

### 3.1 Where it hooks in

The inference route (`apps/web-ui/app/api/v1/inference/route.ts`, 807 lines) currently:

- loads/creates the session and appends the user turn (`route.ts:242–287`),
- builds KB context via `RetrievalService` (`route.ts:402`) and MCP tools (`route.ts:404`),
- composes the system prompt (`route.ts:408–411`),
- executes the model (stream/non-stream, `route.ts:469–682`),
- delivers an optional execution webhook (`route.ts:340–377`).

We insert the trigger engine at **two points**:

- **Pre-response (hard triggers):** after the user turn is appended and *before* model execution, evaluate T1 (explicit), T6 (rules). If a hard trigger fires, **skip model execution**, create the handoff, and return a `handoff` outcome (the AI shouldn't waste a turn when the user already asked for a human).
- **Post-response (soft triggers):** after the model produces its turn, evaluate T2 (the model may have called `request_human_handoff`), T3 (retrieval scores from the KB step), T4 (loop), T5 (sentiment). If the combined policy crosses threshold, create the handoff and annotate the response.

```
appendUserTurn()
  └─▶ TriggerEngine.evaluatePre(turn, session, cfg)      // T1, T6
        ├─ fires(force) → HandoffService.request(...) → return handoff outcome (no model call)
        └─ no fire → continue
  └─▶ buildKbContext() / buildTools()                    // existing; capture retrieval scores for T3
  └─▶ executeModel()  (with optional request_human_handoff tool for T2)
  └─▶ TriggerEngine.evaluatePost(turn, modelResult, retrievalScores, session, cfg)  // T2–T5
        ├─ score ≥ threshold OR T2 tool called → HandoffService.request(...)
        └─ else → return normal AI response
```

### 3.2 Signal implementations

| Signal | Mechanism | Source data |
|---|---|---|
| **T1 explicit** | Intent match on the user turn: button click sends a typed `intent: "human_handoff"` field in the request body; free-text matched by a small classifier or keyword set | request body / user content |
| **T2 AI self-assessment** | Register a `request_human_handoff(reason: string)` tool alongside MCP tools (`route.ts:404`). If the model calls it, the turn yields `{handoff: true, reason}`. Alternative/companion: structured-output `needs_human` field. | model tool call |
| **T3 retrieval confidence** | `RetrievalService` already returns scored chunks at `route.ts:402`. Capture top score; fire if `< minTopScore` **and** the query looks substantive (not chit-chat). | retrieval result |
| **T4 loop** | Maintain a small rolling window on the session (`channelMetadata` or a derived counter) of unresolved repeats; fire at `maxRepeats`. | session message history |
| **T5 sentiment** | Lightweight per-turn frustration score (cheap classifier or heuristic); fire above `frustrationThreshold`. Distinct from the post-hoc `SessionAnalytics.sentiment`. | user turn |
| **T6 rules** | Tenant regex/keyword list from config; deterministic. | user content |

### 3.3 `TriggerEngine` contract

```ts
// libs/shared/src/services/handoff/trigger-engine.ts  (new)
interface TriggerInput {
  tenantId: string;
  session: InferenceSession;
  userTurn: { content: string; intent?: string };
  modelResult?: { toolCalls?: ToolCall[]; text?: string };
  retrieval?: { topScore: number };
  config: HandoffConfig;
}
interface TriggerDecision {
  shouldHandoff: boolean;
  fired: Array<{ signal: 'T1'|'T2'|'T3'|'T4'|'T5'|'T6'; score: number; reason: string }>;
  primaryReason?: string;
}
class TriggerEngine {
  evaluatePre(input: TriggerInput): TriggerDecision;   // T1, T6 (hard)
  evaluatePost(input: TriggerInput): TriggerDecision;  // T2–T5 (scored)
}
```

Pure, synchronous, side-effect-free (returns a decision; the route decides what to do). Fully unit-testable without DB or LLM. Cooldown and `maxPerSession` are enforced using prior `HandoffEvent`s / a counter on the session.

---

## 4. Handoff Service & Router

### 4.1 `HandoffService`

```ts
// libs/shared/src/services/handoff/handoff-service.ts  (new)
class HandoffService {
  request(input: {
    tenantId; sessionId; agentId; channel;
    decision: TriggerDecision;
    contact?: Contact;
  }): Promise<Handoff>;            // creates Handoff(status=requested) + HandoffEvent + audit; triggers summary; calls router
  generateSummary(sessionId): Promise<string>;   // synchronous handoff summary (see §4.3)
  assign(handoffId, operatorId): Promise<Handoff>;     // atomic claim (builtin)
  appendOperatorMessage(handoffId, operatorId, content): Promise<HandoffMessage>;
  appendExternalMessage(handoffId, content): Promise<HandoffMessage>;  // inbound relay
  resolve(handoffId, resolution, opts): Promise<Handoff>;
  returnToBot(handoffId, contextNote): Promise<void>;   // re-enable AI, inject note
  applyFallback(handoffId): Promise<void>;
}
```

Class-based with injected Prisma client, matching `InferenceSessionService` (`libs/shared/src/services/inference-session-service.ts`). All methods wrapped in try/catch with Pino logging `{ tenantId, sessionId, handoffId }` per CLAUDE.md standards.

### 4.2 `HandoffRouter` + adapters

```ts
interface HandoffDestinationAdapter {
  route(handoff: Handoff, ctx: RouteContext): Promise<RouteResult>;
  // RouteResult = { status: 'routed'|'queued'|'fallback', externalRef?, queuePosition? }
}
class HandoffRouter {
  resolveAdapter(channel: string, cfg: HandoffConfig): HandoffDestinationAdapter; // perChannel override → mode
  route(handoff, cfg): Promise<RouteResult>;  // delegates; on adapter failure → fallback chain
}
```

- **`ExternalWebhookAdapter`** — builds the signed payload (§7), enqueues `handoff-webhook-delivery` pg-boss job (delivery is async with retry), sets `status=routed`.
- **`BuiltinQueueAdapter`** — sets `status=queued`, `queuedAt=now`, computes queue position, emits a realtime "new handoff" event to online operators (§6), checks availability/business hours; if none available → fallback.

### 4.3 Synchronous handoff summary

The PRD requires context *at* handoff, not post-hoc. The existing post-hoc summary lives in `apps/workers/src/jobs/inference-session-analytics/handler.ts` (an LLM call producing `summary`, `firstUserQuery`, etc., stored in `SessionAnalytics`). We extract the summarization prompt into a shared helper in `libs/ai` and call it synchronously in `HandoffService.generateSummary()`. To stay within the latency budget, summary generation is **fire-and-forwarded**: the handoff is created immediately with `summary=null`, a `handoff-summary` pg-boss job fills it in within ~1–2s, and the external payload / inbox tolerates a momentarily-absent summary (transcript is always present). For T2 (AI tool) handoffs, the model often already provides a `reason`, which seeds the summary.

---

## 5. Lifecycle State Machine

States are the `Handoff.status` string values. Transitions are the only legal mutations; each writes a `HandoffEvent`.

| From | Event | To | Side effects |
|---|---|---|---|
| — | `request()` | `requested` | create Handoff + event; enqueue summary job; call router |
| `requested` | router → external | `routed` | enqueue webhook delivery; notify user "connecting" |
| `requested` | router → builtin, agent available | `queued` | set queuedAt; emit realtime new-handoff |
| `requested` | router → unavailable | `fallback_*` | run fallback chain |
| `routed` | external ack (bidirectional) / immediate (fire&forget) | `accepted` | set externalRef, firstResponseAt |
| `queued` | operator claims (atomic) | `assigned` | set operatorId, assignedAt; operator.activeCount++ |
| `assigned` | first operator/user message | `active` | set firstResponseAt; suspend AI for session |
| `active`/`accepted` | resolve | `resolved` | set resolvedAt, resolution; operator.activeCount-- |
| `active` | returnToBot | `returned_to_bot` | re-enable AI; inject context note into session |
| any non-terminal | timeout / window-expiry | `fallback_*` or `failed` | per config |

**AI suspension:** while a handoff is `active` (or `assigned` in builtin), the inference route MUST NOT auto-respond. Implementation: `HandoffService` flips an indicator the route checks early (a `handoff` relation on the session with a live status). When present and live, the route short-circuits — user turns are appended and routed to the human (builtin) or relayed (external), not to the model.

**Atomic claim (FR-O2):** `assign()` uses a conditional update — `UPDATE handoffs SET status='assigned', operatorId=? WHERE id=? AND status='queued' AND operatorId IS NULL` (Prisma `updateMany` + affected-count check, or a transaction). Zero rows updated → already claimed → 409 to the second operator. Operator capacity (`activeCount < maxConcurrent`) checked in the same transaction.

---

## 6. Realtime Transport (Built-in Mode)

The codebase has **no realtime infrastructure** today (only LLM-token SSE inside the inference route, `route.ts:469–550`). Built-in live chat needs bidirectional, low-latency delivery: user→operator and operator→user, plus inbox push.

### 6.1 Options & recommendation

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **DB polling** (widget + inbox poll every 2–3s) | Zero new infra; works on serverless/Next; trivial to ship | Latency floor ~2–3s; DB load scales with open chats | **Phase 2 MVP** — meets the ≤2s-ish target, unblocks the feature |
| **SSE** (server→client push; client→server stays HTTP POST) | Reuses the SSE pattern already in the route; half-duplex fits chat well (POST to send, SSE to receive); proxy-friendly | One persistent connection per client; Next.js standalone/long-lived connections need care | **Phase 2/3 target** — best fit for our stack |
| **WebSockets** | True full-duplex | Heaviest infra; needs a WS server outside Next's request model; sticky sessions / scaling | Defer unless presence/typing demands it |
| **Postgres `LISTEN/NOTIFY`** as the fan-out bus behind SSE | No Redis; DB already present | Connection limits at scale; not a client transport by itself | **Recommended fan-out** behind SSE for Phase 3 |

**Recommendation:** ship Phase 2 on **polling** (fastest path, no infra risk), then upgrade the receive path to **SSE backed by Postgres `LISTEN/NOTIFY`** in Phase 3. The send path is always a plain authenticated POST (`HandoffMessage` insert). This keeps the transport swappable behind a thin client API and avoids standing up Redis/WS prematurely.

### 6.2 Message flow (builtin)

```
operator types → POST /api/v1/handoffs/:id/messages (sender=operator)
   → HandoffMessage insert → (poll picks up | NOTIFY → SSE push) → widget renders
user types     → existing widget send path; route sees live handoff → stores as HandoffMessage(sender=user), no model call
   → (poll | SSE) → operator inbox renders
```

---

## 7. External Integration (Webhook)

### 7.1 Outbound handoff event

Delivered by the existing `WebhookService` (`libs/shared/src/services/webhook-service.ts`, HMAC-SHA256), via a `handoff-webhook-delivery` pg-boss job for retry durability (pg-boss `retryLimit=10`, `retryDelay=30s`, `boss.ts`).

```jsonc
// POST {external.webhookUrl}   headers: X-Signature: sha256=<hmac>
{
  "event": "handoff.requested",
  "handoffId": "ckx...",
  "tenantId": "...",
  "sessionId": "...",
  "channel": "SDK",
  "triggeredBy": [{ "signal": "T2", "reason": "billing dispute outside policy" }],
  "summary": "User wants a refund for an annual plan after 40 days; policy allows 30. Bot could not override.",
  "transcript": [
    { "role": "user", "content": "...", "at": "..." },
    { "role": "assistant", "content": "...", "at": "..." }
  ],
  "contact": { "email": null, "name": null },
  "callback": {
    "url": "https://<our-host>/api/v1/handoffs/ckx.../relay",
    "token": "<signed-callback-token>"     // for bidirectional: external posts human replies back
  }
}
```

### 7.2 Inbound relay (bidirectional, Phase 3)

```
POST /api/v1/handoffs/:id/relay
  headers: Authorization/X-Signature verified against callback token (WebhookService.verifySignature)
  body: { sender: "external", content, externalRef? }
  → HandoffService.appendExternalMessage() → delivered to widget (poll/SSE)
POST /api/v1/handoffs/:id/close   (external marks resolved)
```

`callback.token` is a signed, scoped token (HMAC over `handoffId`+`tenantId`+expiry) so only the recipient of the original event can post back — satisfies FR-S2.

---

## 8. API Surface

All under `apps/web-ui/app/api/v1/`, Zod-validated at the boundary, RBAC-guarded where operator-facing.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| (internal) | inference `route.ts` | trigger eval + `handoff` outcome in response | API key (existing) |
| `GET` | `/handoffs` | list (inbox/analytics); filters: status, channel, operator, date | RBAC `LiveChat:read` |
| `GET` | `/handoffs/:id` | detail + unified transcript | RBAC `LiveChat:read` |
| `POST` | `/handoffs/:id/claim` | atomic operator claim | RBAC `LiveChat:update` + operator |
| `POST` | `/handoffs/:id/messages` | operator send | RBAC `LiveChat:update` + assigned operator |
| `POST` | `/handoffs/:id/resolve` | resolve/close | RBAC `LiveChat:update` |
| `POST` | `/handoffs/:id/return-to-bot` | hand back to AI | RBAC `LiveChat:update` |
| `GET` | `/handoffs/stream` (SSE, Phase 3) | inbox + conversation push | RBAC `LiveChat:read` + operator |
| `POST` | `/handoffs/:id/relay` | inbound external relay | signed callback token |
| `POST` | `/handoffs/:id/close` | external close | signed callback token |
| `POST` | `/operators/presence` | set online/away/offline, capacity | RBAC `LiveChat:update` + operator |
| `GET`/`PUT` | `/settings/handoff` | tenant handoff config CRUD | RBAC `Settings` |

The inference response gains a typed `handoff` block (FR-C3):

```jsonc
{ "type": "handoff", "handoffId": "...", "status": "routed", "message": "Connecting you to our team…",
  "mode": "external", "queuePosition": null }
```

---

## 9. Worker Jobs (pg-boss)

Registered alongside existing jobs (`apps/workers/src/jobs/`: `document-ingestion`, `web-crawl`, `inference-session-analytics`, `inference-session-idle-watcher`). Follow the same `register.ts`/`handler.ts` pattern and pg-boss config in `apps/workers/src/boss.ts`.

| Job | Trigger | Work |
|---|---|---|
| `handoff-summary` | on `request()` | generate synchronous-ish summary, update `Handoff.summary` |
| `handoff-webhook-delivery` | external routing | `WebhookService.deliver()` with HMAC; retries via pg-boss; writes `webhook_delivered`/`webhook_failed` events |
| `handoff-queue-sweeper` | scheduled (~every 1 min) | enforce `maxQueueWait`, business-hours transitions, escalate to fallback; analogous to `inference-session-idle-watcher` (`handler.ts:1–59`) |
| `handoff-fallback` | on fallback decision | send capture-email / create-ticket via `EmailService` (wire `ses-email-service.ts`), persist contact |
| `handoff-notify` | on `queued` | notify operators (email backstop until SSE exists) |

---

## 10. Configuration & Validation

- **Storage:** `TenantConfig` key `handoffConfig` via `TenantConfigService.get/set` (`tenant-config-service.ts`).
- **Validation:** a `handoffConfigSchema` Zod schema in `libs/shared` validates on write (admin API) and on read (defensive parse with safe defaults). Per CLAUDE.md, no direct `process.env`; any handoff-related env (e.g. default timeouts) goes through T3 Env.
- **Secrets:** `external.webhookSecret` encrypted via `EncryptionService` before storage; never logged.
- **Defaults (FR-CFG2):** `enabled:false`; when enabled with no other config → `triggers.explicit:true` + external if `webhookUrl` set, else `fallback:["capture_email","graceful_close"]`.

---

## 11. RBAC Additions

Current modules (`libs/shared/src/rbac/types.ts:1`): `Settings | Users | Tenants | Agents | KnowledgeBases | McpServers | LlmProviders`. Add **`LiveChat`**:

```ts
// types.ts
export type Module = ... | 'LiveChat';
// SUBJECT_TO_MODULE additions:
Handoff: 'LiveChat',
HandoffMessage: 'LiveChat',
Operator: 'LiveChat',
```

Permissions (`libs/shared/src/rbac/permissions.ts`): grant `LiveChat: ['create','read','update','delete']` to Owner/Admin; **Operator capability** is modeled as `LiveChat:['read','update']`. Two valid approaches (open question #4 — recommend (a)):

- **(a) Capability on existing roles** — add `LiveChat` perms to the relevant predefined/custom roles; an operator is any user whose role includes `LiveChat:update` *and* who has an `Operator` presence row. Minimal change, reuses `custom-role-service.ts`.
- **(b) New predefined role `Operator`** (RoleLevel) — cleaner conceptually but expands the role enum and migration surface.

`Operator` rows scope all inbox/claim queries by `tenantId`, preserving isolation (FR-S1). All operator actions audited via `AuditService` (FR-S).

---

## 12. Channel Adapters

| Channel | Handoff handling |
|---|---|
| **SDK widget** | Best UX. Widget reads the `handoff` block / polls handoff status; renders "connecting", queue position, "Operator joined". Built-in or external-relay. Widget changes in `apps/sdk/src/components/smc-chat-widget/` and message components. |
| **REST API** | Returns typed `handoff` block (§8); integrator decides surfacing. External webhook still fires. |
| **WhatsApp** | Route via existing `WhatsAppRouting` (`schema.prisma:688–715`, has `strategy`, `fallbackAgentId`, rules) and `WhatsAppSession` (`schema.prisma:717–738`, `windowExpiresAt`). Human replies sent as WhatsApp session/template messages. The `handoff-queue-sweeper` must detect window expiry (open question #5) and convert to async fallback (capture/ticket). |
| **Telegram** | Deferred (connector is scaffolding). |

The router's `perChannel` config (§2.5) lets a tenant pick built-in on SDK and external on WhatsApp simultaneously.

---

## 13. Security & Privacy

- **Tenant isolation:** every query filters by `tenantId`; consistent with middleware `x-tenant-id` injection. Inbox/claim/relay all tenant-scoped. (FR-S1)
- **Webhook signing:** outbound HMAC via `WebhookService`; inbound relay verified via signed callback token (`WebhookService.verifySignature`). (FR-S2)
- **PII:** transcripts + contact captures are PII. Encrypt secrets via `EncryptionService`; never log raw transcript/PII (Pino structured context only — `{tenantId, sessionId, handoffId}`); webhook payloads sent only to tenant-configured, signed endpoints over HTTPS.
- **Authz:** all operator endpoints behind RBAC `LiveChat` + `authorize.ts`.
- **Audit:** every lifecycle transition and config change → `AuditLog` via `AuditService` (`audit-service.ts`).
- **Abuse/cost:** T2's optional LLM tool round-trip and `handoff-summary` LLM call gated by existing quota (`quota-service.ts`) / a per-tenant handoff budget (open question #7).

---

## 14. Observability

- **Logging:** Pino, structured `{tenantId, sessionId, handoffId, signal?, operatorId?}` on every transition; severities per CLAUDE.md.
- **Metrics (funnel):** counters/timers for triggered, routed, queued, time-to-agent, resolved, false-handoff, fallback-capture, webhook delivery success/latency. Sourced from `HandoffEvent` timestamps.
- **Dashboard:** extend `apps/web-ui/app/(dashboard)/sessions/page.tsx` with handoff filters (status, trigger reason, operator, resolution) and the funnel view (FR-A2). Reuse `CsatService`/`FeedbackService` for post-handoff quality.
- **Alerting (internal):** webhook-failure rate and queue depth surfaced for platform operators.

---

## 15. Phased Implementation Plan

| Phase | Scope | New infra? | Key deliverables |
|---|---|---|---|
| **P1** | Trigger engine (T1, T2, T6) + external fire-and-forget | No | `Handoff`/`HandoffEvent` models; `TriggerEngine`; `HandoffService`; `HandoffRouter`+`ExternalWebhookAdapter`; `handoff-summary` + `handoff-webhook-delivery` jobs; config + Zod; capture-email/close fallback; audit + basic analytics. **All on existing infra** (WebhookService, pg-boss, TenantConfig, EmailService, AuditService). |
| **P2** | Built-in live chat (polling) | Polling only | `Operator` model + presence; RBAC `LiveChat`; Agent Inbox UI; atomic claim; `HandoffMessage`; operator/user messaging via polling; queue + `handoff-queue-sweeper`; return-to-bot; widget handoff states. |
| **P3** | SSE upgrade + bidirectional external + WhatsApp | SSE + LISTEN/NOTIFY | SSE receive path behind `LISTEN/NOTIFY`; inbound relay API + signed callbacks; WhatsApp routing via `WhatsAppRouting`/window handling; richer triggers (T3/T4/T5). |
| **P4** | Optimization | — | Skills/priority routing, SLAs, callback scheduling, agent-assist, Telegram/voice exploration. |

Each phase is independently shippable and gated behind `handoffConfig.enabled` per tenant.

---

## 16. Testing Strategy

Per CLAUDE.md (Vitest unit per project; Playwright e2e at root; services class-based with injected Prisma).

- **TriggerEngine (unit):** pure function — table-driven tests across T1–T6, policy thresholds, cooldown, `maxPerSession`. No DB/LLM. Highest-value tests.
- **HandoffService (unit/integration):** lifecycle transitions, atomic-claim race (two concurrent claims → one 409), fallback chain, return-to-bot context injection. Real DB (no mocks for DB-level invariants like atomic claim).
- **Router/adapters (unit):** external payload shape + HMAC; builtin queue/availability; per-channel override resolution; adapter-failure → fallback.
- **Inference route (integration):** pre-trigger short-circuit (no model call on T1/T6), post-trigger annotation, AI suspension while handoff live, response `handoff` block schema.
- **Jobs (integration):** webhook delivery + retry on 5xx; summary backfill; queue sweeper timeout/business-hours/window-expiry transitions.
- **API (integration):** RBAC enforcement on operator endpoints; tenant isolation (no cross-tenant reads/claims); relay token verification.
- **E2e (Playwright):** widget explicit-handoff → external webhook fired (P1); operator claims and chats, user sees operator messages (P2).
- **Security tests:** cross-tenant access denial; relay with bad/expired token rejected; PII not present in logs.

---

## 17. Open Technical Questions (carried from PRD)

1. **Routing default** — ship external-only (P1) vs invest in pluggable both-router up front. *(Recommend external-only first.)*
2. **Realtime transport** — polling → SSE+`LISTEN/NOTIFY` (recommended) vs websockets.
3. **T2 mechanism** — `request_human_handoff` tool vs structured `needs_human` field vs both. Affects agent execution at `route.ts:404` / model config.
4. **Operator identity** — capability-on-existing-user (recommended) vs new predefined role.
5. **WhatsApp window expiry mid-handoff** — convert to async fallback; exact UX TBD.
6. **Inbox build vs external-first** — how much to invest in the in-app inbox vs positioning external as primary.
7. **Cost controls** — gate T2 round-trip + summary LLM calls behind a per-tenant handoff budget via `quota-service.ts`.

---

## Appendix — Touched / New Files (indicative)

**New:**
- `prisma/schema.prisma` — `Handoff`, `HandoffEvent`, `HandoffMessage`, `Operator` (+ relations on `Tenant`, `InferenceSession`, `AuthUser`); migration.
- `libs/shared/src/services/handoff/` — `trigger-engine.ts`, `handoff-service.ts`, `router.ts`, `adapters/external-webhook.ts`, `adapters/builtin-queue.ts`, `config-schema.ts` (+ tests).
- `apps/workers/src/jobs/handoff-*/` — `handoff-summary`, `handoff-webhook-delivery`, `handoff-queue-sweeper`, `handoff-fallback`, `handoff-notify` (`register.ts`+`handler.ts` each).
- `apps/web-ui/app/api/v1/handoffs/**` and `/operators/presence`, `/settings/handoff`.
- `apps/web-ui/app/(dashboard)/live-chat/**` — Agent Inbox UI (P2).
- `apps/sdk/src/components/` — widget handoff states.

**Modified:**
- `apps/web-ui/app/api/v1/inference/route.ts` — trigger hooks (pre ~`:287`, post ~`:606/:682`), `request_human_handoff` tool registration (~`:404`), AI-suspension check, `handoff` response block.
- `libs/shared/src/rbac/types.ts` (+`LiveChat`), `permissions.ts`.
- `apps/web-ui/app/(dashboard)/sessions/page.tsx` — handoff analytics/filters.
- `libs/ai` — extracted summarization helper shared with `inference-session-analytics`.

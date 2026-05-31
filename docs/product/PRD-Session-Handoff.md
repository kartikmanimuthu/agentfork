# Session Handoff (Human Escalation) — Product Requirements Document

**Product Name:** Session Handoff
**Version:** 0.1 (Draft — for later revision)
**Status:** Draft
**Author:** Kartik Manimuthu + Claude
**Date:** 2026-05-31
**Related TRD:** `docs/specs/2026-05-31-session-handoff-trd.md`

---

## Executive Summary

Session Handoff lets a live chatbot conversation escalate from the AI agent to a human when the AI cannot adequately resolve the user's query. The handoff routes the conversation either to an **external agent-desk system** (Zendesk, Intercom, Freshdesk, or a tenant's custom backend) via webhook, or to a **built-in live-chat surface** where the tenant's own human operators take over in real time. The feature closes the single largest gap in any production SaaS chatbot: the "dead end" where the bot repeats itself, the user gets frustrated, and there is no path to a human.

This document specifies *what* we are building and *why*. The companion TRD specifies *how*.

> **Scope note.** This PRD deliberately covers the full feature surface so it can be reviewed end-to-end later. The recommended build sequence (see [§12 Phasing](#12-phasing--release-plan)) ships the external-webhook path first because it reuses infrastructure that already exists in the codebase, and defers the realtime built-in live-chat surface — which requires net-new realtime infrastructure — to a later phase.

---

## Problem Statement

The platform today has **no escape hatch from the AI**. Tracing the inference path (`apps/web-ui/app/api/v1/inference/route.ts`), a user query is turned into an LLM completion and returned. There is:

- **No "can't answer" signal at inference time.** The LLM returns text unconditionally. `SessionAnalytics.isResolved` and `SessionAnalytics.confidenceScore` exist (`prisma/schema.prisma:550–572`) but are computed *post-hoc* by the `inference-session-analytics` worker job after a session has already ended — far too late to rescue a live conversation.
- **No human-agent concept.** RBAC defines Owner / Admin / Member / Viewer only (`libs/shared/src/rbac/`); there is no operator/agent role, no presence, no inbox.
- **No realtime transport.** The stack is request/response. The only streaming is LLM token SSE inside the inference route. There is no websocket, no pub/sub, no `LISTEN/NOTIFY`.
- **No graceful failure.** If the LLM errors, the route returns HTTP 500. The user sees a broken bot.

The result: when the bot is stuck, the conversation dies. For a multi-tenant SaaS chatbot sold to businesses, this is a top-tier objection — buyers expect "talk to a human" as table stakes, and they expect to measure deflection (% resolved by AI) versus escalation (% handed to humans).

---

## Goals & Success Metrics

### Goals

- Give every live conversation a reliable path to a human when the AI is insufficient.
- Make the *trigger* ("can't answer") an explicit, configurable, multi-signal decision rather than a guess.
- Support both **external** (route to the customer's existing helpdesk) and **built-in** (our own operator surface) handoff, selectable per tenant.
- Preserve full conversation context across the handoff so the user never repeats themselves.
- Make handoff a first-class, measurable funnel: trigger → routed → accepted → resolved.

### Non-Goals (this version)

- A full-featured helpdesk/ticketing product. We integrate with helpdesks; we do not replace them.
- Voice / telephony handoff. (Listed as a future channel; not specced here.)
- Co-pilot / agent-assist (AI suggesting replies to the human). Future enhancement.
- Skills-based routing, SLAs, and shift scheduling beyond a minimal availability model.

### Success Metrics (first 6 months post-GA)

| Metric | Definition | Target |
|---|---|---|
| **Handoff success rate** | Handoffs that reach an agent (external accepted or in-app claimed) ÷ handoffs triggered | ≥ 95% |
| **Time-to-agent (in-app)** | Median seconds from trigger to operator claim, during staffed hours | ≤ 60s |
| **Containment / deflection** | Sessions resolved by AI ÷ total sessions (should stay healthy, not collapse) | ≥ 70% |
| **Post-handoff resolution** | Handed-off sessions marked resolved by the human | ≥ 90% |
| **False-handoff rate** | Handoffs the operator immediately returns to bot as unnecessary | ≤ 10% |
| **Fallback capture rate** | When no agent is available, % of users who leave a contactable email/ticket | ≥ 80% |

---

## Target Users

| Persona | Description | Primary Use Case |
|---|---|---|
| **End User (Visitor)** | The person chatting with the widget/API on a tenant's site or app | Wants a real answer; needs a frictionless "get me a human" when the bot fails |
| **Human Operator / Live-Chat Agent** | A tenant employee who answers escalated chats | Picks up queued conversations, reads AI context, resolves, returns to bot or closes |
| **Tenant Admin** | Configures the chatbot for their organization | Sets handoff triggers, routing mode, business hours, fallback behavior, integrations |
| **External Helpdesk** | A third-party system (Zendesk/Intercom/custom) | Receives handoff events via webhook and owns the conversation downstream |
| **Platform Operator (us)** | Internal | Monitors handoff health, webhook delivery, queue depth across tenants |

---

## Core Concept: The Handoff Lifecycle

Every handoff moves through an explicit state machine. This is the spine of the whole feature.

```
                ┌──────────────────────────────────────────────┐
                │                  AI handling                   │
                └───────────────────────┬──────────────────────┘
                                         │  trigger fires
                                         ▼
                                  ┌─────────────┐
                                  │  REQUESTED  │  handoff created, not yet routed
                                  └──────┬──────┘
                                         │  router selects destination
                          ┌──────────────┴───────────────┐
                          ▼                               ▼
                   (external mode)                  (built-in mode)
                  ┌─────────────┐                  ┌─────────────┐
                  │   ROUTED    │ webhook sent     │   QUEUED    │ awaiting operator
                  └──────┬──────┘                  └──────┬──────┘
                         │ ext. ack / no-op               │ operator claims
                         ▼                                ▼
                  ┌─────────────┐                  ┌─────────────┐
                  │  ACCEPTED   │◄─────────────────│  ASSIGNED   │
                  └──────┬──────┘                  └──────┬──────┘
                         │                                │ live human↔user messaging
                         │                                ▼
                         │                         ┌─────────────┐
                         │                         │   ACTIVE    │
                         │                         └──────┬──────┘
                         └───────────────┬───────────────┘
                                         ▼
                          ┌──────────────────────────────┐
                          │  RESOLVED → (optional) bot     │  return to AI, or
                          │  RETURNED_TO_BOT / CLOSED      │  close session
                          └──────────────────────────────┘

   Failure / timeout edges from REQUESTED, ROUTED, QUEUED →  FALLBACK
   (no agent available → capture email / create ticket / schedule callback / closed_unresolved)
```

---

## 1. Trigger Engine ("Can't Answer" Detection)

The trigger is the heart of the feature and the part most products get wrong. We support **multiple signal types**, each independently toggleable per tenant, combined by a policy.

### 1.1 Trigger Signals

| # | Signal | How it's detected | Latency | Notes |
|---|---|---|---|---|
| **T1** | **Explicit user request** | User says "talk to a human" / clicks a "Talk to a person" button in the widget; intent classified on the user turn | Immediate | Highest-confidence trigger; must always be available even if others are off |
| **T2** | **AI self-assessment** | The agent is given a `request_human_handoff` tool/function it can call when it judges the query out of scope; or a structured-output field `needs_human: boolean` + `reason` | Immediate (inference-time) | Most reliable *automated* signal because the model decides while it has full context |
| **T3** | **Low retrieval confidence** | KB retrieval (`RetrievalService`) returns top-k below a similarity threshold → the agent has no grounding | Immediate | Good for "we have no docs on this" cases |
| **T4** | **Repeated failure / loop** | N consecutive turns where the user rephrases the same unanswered question, or repeated "that didn't help" | 2–3 turns | Heuristic; needs turn-level tracking on the session |
| **T5** | **Negative sentiment / frustration** | Lightweight sentiment classification on the user turn crosses a frustration threshold | Per-turn | Reuses analytics-style scoring but at inference time, not post-hoc |
| **T6** | **Keyword / regex rules** | Tenant-defined patterns (e.g. "cancel my account", "legal", "refund > $X") | Immediate | Lets tenants force escalation for sensitive intents regardless of AI confidence |

### 1.2 Trigger Policy

Per tenant, signals combine into a decision:

- Each enabled signal has a **weight** and/or a hard **force-escalate** flag.
- **T1 (explicit) and T6 (rules)** are hard triggers — they escalate immediately, bypassing scoring.
- **T2–T5** contribute to a score; escalation fires when the score crosses `escalationThreshold`.
- A **cooldown** prevents thrash (e.g. don't re-trigger within N turns of a returned-to-bot session).
- A **per-session handoff cap** prevents infinite escalate→return→escalate loops.

### 1.3 Requirements

- **FR-T1:** The system MUST evaluate triggers at inference time, on the inference path, before returning the AI's reply to the user (so T1/T2/T3/T6 can short-circuit a low-value AI answer).
- **FR-T2:** Tenants MUST be able to enable/disable each signal and tune thresholds via tenant config, with safe defaults.
- **FR-T3:** The agent MUST be optionally equipped with a `request_human_handoff` tool (T2). When called, the agent's turn yields a handoff intent plus a machine-readable `reason`.
- **FR-T4:** Every trigger evaluation MUST be recorded (which signals fired, scores, decision) for analytics and tuning.
- **FR-T5:** Explicit user request (T1) MUST always be honorable even when automated triggers are disabled.

---

## 2. Routing Modes

A tenant selects **one routing mode** (with a per-channel override option). The router is the abstraction that both modes plug into.

### 2.1 External Mode (Webhook → Agent-Desk)

The chatbot detects the trigger and emits a signed **handoff event** to the tenant's configured endpoint. The external system owns the conversation thereafter.

- Reuses the existing `WebhookService` (HMAC-SHA256 signing, `libs/shared/src/services/webhook-service.ts`) and the `webhookUrl`/`webhookSecret` pattern already on `ApiKey`.
- Payload includes: session ID, tenant ID, channel, full transcript, AI-generated summary, trigger reason, user contact (if known), and a callback URL/token the external system can use to post messages back or to close the handoff.
- **Two integration depths:**
  - **Fire-and-forget (v1):** We notify; the external system takes over (e.g. opens a Zendesk ticket / Intercom conversation). The chatbot tells the user "connecting you to our team" and the conversation continues in the external tool / via email.
  - **Bidirectional relay (v1.5):** The external system posts the human's replies back to our callback API, and we relay them into the original widget — so the user stays in the chat widget while a Zendesk agent answers. Requires the inbound relay API + (eventually) realtime push to the widget.

### 2.2 Built-in Mode (In-App Live Chat)

Human operators log into our product. An **Agent Inbox** shows queued and active handoffs; an operator **claims** a conversation and chats live with the user.

- Requires net-new **realtime transport** (the codebase has none today) — see TRD for SSE-vs-websocket-vs-poll decision.
- Requires a new **operator role** in RBAC, **presence/availability**, and the **inbox + takeover UI**.
- The AI is suspended for the session while a human is `ACTIVE`; messages flow human↔user. On resolve, the operator can **return to bot** or **close**.

### 2.3 Pluggable Router

- **FR-R1:** A `HandoffRouter` MUST resolve a triggered handoff to a destination based on tenant config: `external` | `builtin` | (later) `both`/priority chain.
- **FR-R2:** Routing config MUST be per-tenant and overridable per-channel (a tenant might use built-in live chat on the web widget but webhook-to-helpdesk on WhatsApp).
- **FR-R3:** The router MUST handle "destination unavailable" by falling through to the configured fallback ([§4](#4-fallback--no-agent-available)).

---

## 3. Channel Behavior

Handoff means different things on different channels. The router and lifecycle MUST account for this.

| Channel | Sync model | Handoff behavior | Constraints |
|---|---|---|---|
| **SDK Web Widget** | Synchronous, user present | Best experience: live takeover (built-in) or live relay (external). User watches the conversation transition. | Needs realtime push for built-in/bidirectional; polling acceptable for v1 |
| **REST API (`/v1/inference`)** | Caller-defined | We return a `handoff` outcome in the response + emit the webhook; the integrator decides how to surface it | No UI owned by us; contract must be explicit |
| **WhatsApp** | Asynchronous, 24h window | Handoff routes into the existing `WhatsAppSession` / `WhatsAppRouting` model; human replies sent via WhatsApp template/session messages | Bounded by WhatsApp 24-hour customer-care window (`WhatsAppSession.windowExpiresAt`) |
| **Telegram** | Async | Future — connector is "coming soon" scaffolding today | Deferred |

- **FR-C1:** The widget MUST visually indicate handoff state ("Connecting you to a person…", "You're #3 in line", "Alex from Support joined").
- **FR-C2:** WhatsApp handoff MUST respect the messaging window and use the existing routing model rather than a parallel one.
- **FR-C3:** The API response schema MUST include a typed `handoff` block when a handoff is triggered, so non-UI integrators can react.

---

## 4. Fallback — No Agent Available

The most-forgotten requirement. Off-hours, all operators busy, webhook down, or no integration configured.

Per-tenant configurable fallback chain, evaluated in order:

1. **Queue with wait** — hold in `QUEUED`, show position/estimated wait (built-in mode, within staffed hours).
2. **Capture contact** — ask the user for email/phone, create a follow-up record, promise async reply.
3. **Create ticket** — emit a ticket-creation webhook / email to the tenant's support inbox (reuses `EmailService` once SES is wired; `ses-email-service.ts` exists but is not yet active).
4. **Schedule callback** — collect a preferred time (if tenant enables it).
5. **Graceful close** — apologize, set `closed_unresolved`, surface in analytics.

- **FR-F1:** Every handoff that cannot reach an agent MUST resolve to a defined fallback state — never a dead end or a hang.
- **FR-F2:** Business-hours / availability MUST be checked before promising a live agent.
- **FR-F3:** Fallback captures (email/ticket/callback) MUST be persisted and visible to the tenant.

---

## 5. Context Transfer

When a human (or external system) receives the handoff, they MUST get enough context to continue without the user repeating themselves.

The handoff payload / inbox view MUST include:

- **Full transcript** of the session (`InferenceSessionMessage` rows).
- **AI-generated summary** — what the user wants, what was tried, why it escalated (generated on handoff; conceptually reuses the summarization approach from `inference-session-analytics`, but synchronously at handoff time).
- **Trigger reason** — which signal(s) fired and the machine reason (e.g. `tool:request_human_handoff: "billing dispute outside policy"`).
- **User identity & metadata** — whatever is known (contact, channel, locale, tenant, prior sessions if available).
- **Suggested intent / category** — best-effort classification to help routing and operator prioritization.

- **FR-X1:** A handoff summary MUST be generated at handoff time, not deferred to the post-session job.
- **FR-X2:** Transcript + summary + reason MUST be delivered in the external webhook payload and rendered in the built-in inbox.

---

## 6. Operator Experience (Built-in Mode)

For the built-in live-chat surface (later phase):

- **Agent Inbox:** list of `QUEUED` and `ASSIGNED`/`ACTIVE` conversations, with summary, channel, wait time, sentiment, and a claim action.
- **Presence/Availability:** operator toggles online/away; capacity (max concurrent chats) per operator.
- **Conversation view:** transcript with clear AI-vs-user-vs-operator attribution, the AI context panel (summary, trigger reason, KB hits), and a composer.
- **Actions:** claim, send message, transfer to another operator, return-to-bot, resolve/close, add internal note, tag/categorize.
- **Notifications:** new-handoff alert (in-app; email as a backstop until realtime exists).

- **FR-O1:** Only users with the operator capability MAY view/claim handoffs, scoped to their tenant.
- **FR-O2:** A conversation claimed by one operator MUST NOT be simultaneously claimable by another (claim is atomic).
- **FR-O3:** Operator messages MUST be attributed and stored distinctly from AI messages.

---

## 7. Return Path & Resolution

- After a human resolves, the operator MAY **return the session to the bot** (AI resumes) or **close** it.
- On return-to-bot, the AI MUST receive the post-handoff context (what the human did) so it doesn't contradict the resolution.
- Resolution status (resolved / unresolved / returned) MUST be recorded for metrics.

- **FR-RP1:** Return-to-bot MUST re-enable AI handling and inject a context note summarizing the human interaction.
- **FR-RP2:** Resolution outcome MUST be captured and feed the success metrics in this PRD.

---

## 8. Configuration (Tenant Admin)

All handoff behavior is tenant-scoped, stored via the existing `TenantConfig` key-value mechanism (`TenantConfigService`).

Admin-configurable surface:

- **Master enable** + per-channel enable.
- **Routing mode** (`external` / `builtin`) + per-channel override.
- **Trigger signals** — toggle T1–T6, set thresholds, weights, keyword rules, cooldown, per-session cap.
- **External integration** — webhook URL, secret, integration depth (fire-and-forget vs bidirectional), payload options.
- **Business hours / availability** — timezone, schedule; behavior outside hours.
- **Fallback chain** — ordered list + per-step config (capture email, ticket endpoint, callback).
- **Operator settings** (built-in) — max concurrent chats, auto-assign vs manual claim.
- **Messaging** — customizable user-facing strings ("Connecting you…", queue messages, off-hours message), localizable.

- **FR-CFG1:** All settings MUST validate at the boundary (Zod) and be stored as typed tenant config.
- **FR-CFG2:** Safe defaults MUST exist so handoff "just works" when a tenant flips the master switch (default: T1 explicit + external webhook if configured, else capture-email fallback).

---

## 9. Analytics & Reporting

Handoff is a funnel and MUST be measurable. The existing **Sessions** dashboard (`apps/web-ui/app/(dashboard)/sessions/page.tsx`) is the natural home.

- **Funnel:** triggered → routed/queued → accepted/claimed → resolved, with drop-off at each stage.
- **Trigger breakdown:** which signals drive handoffs (tune the policy).
- **Operational:** time-to-agent, queue depth, abandonment, operator load (built-in); webhook delivery success/latency (external).
- **Quality:** post-handoff resolution rate, false-handoff rate, CSAT on handed-off sessions (reuse `CsatService`).
- **Containment:** AI deflection rate over time (guardrail — handoff shouldn't cannibalize healthy AI resolution).

- **FR-A1:** Every lifecycle transition MUST be timestamped and queryable per tenant.
- **FR-A2:** The Sessions dashboard MUST gain a handoff view/filters (status, trigger reason, operator, resolution).

---

## 10. Security, Privacy & Compliance

- **Tenant isolation:** handoff data, operator access, and webhooks MUST be strictly tenant-scoped (consistent with existing middleware `x-tenant-id` injection).
- **Webhook signing:** outbound handoff webhooks MUST be HMAC-signed (existing `WebhookService`); inbound relay MUST verify signatures.
- **PII handling:** transcripts and contact captures contain PII; storage and webhook transmission MUST follow existing encryption patterns (`EncryptionService` for secrets) and avoid logging raw PII (per CLAUDE.md logging standards — structured context, no PII in logs).
- **Authorization:** operator actions MUST go through RBAC; a new operator capability MUST be added without weakening existing roles.
- **Audit:** all handoff lifecycle events and config changes MUST be written to `AuditLog` via `AuditService`.

- **FR-S1:** No cross-tenant handoff visibility under any code path.
- **FR-S2:** All inbound relay endpoints MUST authenticate (signed callback token) before injecting messages into a session.

---

## 11. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Latency** | Trigger evaluation MUST add ≤ 150ms p95 to the inference path (excluding any added LLM tool round-trip). |
| **Reliability** | Handoff creation MUST be durable (DB-backed) and survive process restarts; webhook delivery MUST retry (reuse pg-boss retry semantics, `boss.ts`: retryLimit=10). |
| **Scalability** | Queue and inbox MUST handle bursty handoffs without blocking the inference path (async via pg-boss). |
| **Realtime (built-in)** | In-app message delivery latency target ≤ 2s; transport choice deferred to TRD. |
| **Consistency** | Claim/assignment MUST be atomic (no double-claim). |
| **Observability** | Structured Pino logs with `{ tenantId, sessionId, handoffId }` on every transition; metrics emitted for the funnel. |
| **Backwards-compat** | Feature OFF by default per tenant; zero behavior change for tenants who don't enable it. |

---

## 12. Phasing / Release Plan

Sequenced to ship value early on existing infrastructure, deferring the heavy realtime build.

### Phase 1 — Trigger + External Handoff (fire-and-forget)
- Trigger engine with T1 (explicit), T2 (AI tool), T6 (rules); thresholds in tenant config.
- `HandoffRouter` with external mode only.
- Signed webhook payload (transcript + synchronous summary + reason) via `WebhookService`.
- Fallback: capture-email / graceful close.
- Lifecycle persisted; audit + basic analytics.
- **Why first:** reuses `WebhookService`, `TenantConfig`, pg-boss, `AuditService`, `EmailService` — no realtime, no new UI surface beyond config + analytics.

### Phase 2 — Built-in Live Chat
- Realtime transport (TRD decision).
- Operator role in RBAC, presence/availability.
- Agent Inbox + takeover UI; atomic claim; operator messaging.
- Queue + position; return-to-bot path.

### Phase 3 — Bidirectional External Relay + Channels
- Inbound relay API (external human replies → widget) with signed callbacks.
- WhatsApp handoff via existing `WhatsAppRouting` within the 24h window.
- Richer triggers (T3 retrieval-confidence, T4 loop detection, T5 sentiment).

### Phase 4 — Optimization
- Skills/priority routing, SLAs, callback scheduling, agent-assist (AI suggests replies), Telegram + voice exploration.

---

## 13. Open Questions (for later revisit)

1. **Routing-mode default fork** — ship external-only first (recommended), or invest in the pluggable both-router up front? *(This was the open decision when the PRD was requested.)*
2. **Realtime transport** — SSE (simplest given existing SSE usage), websockets (true bidirectional), or DB-polling MVP? Trade-offs in TRD.
3. **AI self-assessment mechanism** — dedicated `request_human_handoff` tool vs structured-output `needs_human` field vs both? Affects agent execution path.
4. **Operator identity** — are operators full platform Users with an added capability, or a separate lightweight entity? Impacts RBAC and auth.
5. **WhatsApp window expiry mid-handoff** — what happens to a queued WhatsApp handoff when the 24h window closes before an agent picks up?
6. **Build vs integrate for the inbox** — build our own operator inbox, or position external mode as the primary path and keep built-in minimal?
7. **Cost controls** — should an added LLM tool round-trip for T2 be gated by a per-tenant budget, given existing quota/cost concerns?

---

## Appendix A — Existing Building Blocks We Reuse

| Capability | Where it lives | Reused for |
|---|---|---|
| Per-tenant config | `TenantConfigService`, `TenantConfig` model | All handoff settings |
| Signed webhooks | `WebhookService` (HMAC-SHA256) | External handoff events + inbound relay verification |
| Async jobs + retry | pg-boss (`apps/workers/src/boss.ts`) | Webhook delivery, summary generation, fallbacks |
| Session lifecycle | `InferenceSessionService`, `InferenceSession`/`InferenceSessionMessage` | Handoff attaches to live sessions |
| Post-hoc analysis | `inference-session-analytics` job, `SessionAnalytics` | Pattern for synchronous handoff summary |
| Email | `EmailService` (console) / `ses-email-service.ts` (stub) | Ticket/contact-capture fallback |
| Audit | `AuditService`, `AuditLog` | Lifecycle + config audit trail |
| WhatsApp routing | `WhatsAppRouting` (`fallbackAgentId`, `strategy`, rules) | WhatsApp-channel handoff routing |
| CSAT/feedback | `CsatService`, `FeedbackService` | Post-handoff quality measurement |
| Sessions dashboard | `apps/web-ui/app/(dashboard)/sessions/page.tsx` | Handoff analytics surface |

## Appendix B — Glossary

- **Handoff** — the act/record of transferring a live session from AI to human.
- **Trigger** — a signal that should cause a handoff.
- **Routing mode** — `external` (webhook) or `builtin` (in-app live chat).
- **Operator / Agent** — a human who handles escalated chats. ("Agent" overloads the AI-agent term; in handoff UI we prefer **Operator**.)
- **Containment / Deflection** — share of sessions resolved without a human.
- **Fallback** — what happens when no human can take the handoff.

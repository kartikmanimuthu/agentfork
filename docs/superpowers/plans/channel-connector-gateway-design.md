# Channel Connector / Gateway — Design Reference

A portable design doc for the "channel connector" pattern used by Agent Ops
(`apps/web-ui/lib/gateway/`) to let external platforms (Slack, Telegram, Discord,
Jira, generic webhooks, direct API) trigger a long-running agent job and receive
streamed results / human-in-the-loop (HIL) prompts back. Written to be
implementable in a different service from scratch — it describes the generic
pattern first, then the specific per-channel protocol details as a reference
table.

## 1. Core idea

One small interface (`ChannelAdapter`) hides every platform's transport/auth/
message-format quirks behind six methods. A generic **gateway service** and
**notification router** never know which platform they're talking to — they only
know `channelType` and two declared capability flags (`deliveryMode`,
`hilCapabilities`). Adding a new platform means writing one adapter file; zero
changes to the executor or router.

```
External platform                Gateway (per-tenant)                 Job executor
─────────────────                ────────────────────                 ────────────
Slack / Telegram / Discord  ──►  POST /gateway/{channel}              executeRun(run, eventBus)
Jira / Webhook / API             → adapter.validateRequest()          (your agent / workflow engine)
                                 → adapter.parseInbound()              emits events ──┐
                                 → jobService.createRun()                             │
                                 → notificationRouter.attachToRun()                   ▼
                                 → adapter.sendAck()   (instant 200)
                                 → executeRun()  (fire-and-forget)
   ◄── results / approvals ──    NotificationRouter  ◄──────────────────────  EventBus
       (sendResult, sendClarification, sendApprovalRequest)              (keyed by runId)
```

## 2. The `ChannelAdapter` interface

```ts
type ChannelType = 'slack' | 'jira' | 'discord' | 'telegram' | 'webhook' | 'api';
type DeliveryMode = 'streaming' | 'callback' | 'polling';

interface HilCapabilities {
    clarification: boolean;   // can it ask the user a follow-up question mid-run?
    approvalButtons: boolean; // can it render approve/reject affordances?
    threadedReplies: boolean; // can replies be scoped to a thread/conversation?
}

interface GatewayMessage {
    channelType: ChannelType;
    tenantId: string;
    taskDescription: string;
    userId?: string;
    replyContext?: ReplyContext;     // present => this is a resume, not a new run
    channelMeta: Record<string, unknown>; // polymorphic, persisted verbatim as run.trigger
}

interface ReplyContext {
    runId: string;
    action: 'clarification_response' | 'approve' | 'reject';
    content?: string;
    tenantId?: string;
}

interface ChannelAdapter {
    readonly channelType: ChannelType;
    readonly deliveryMode: DeliveryMode;
    readonly hilCapabilities: HilCapabilities;

    validateRequest(req): Promise<boolean>;      // signature/secret check
    parseInbound(req): Promise<GatewayMessage>;  // normalize platform payload
    sendAck(req, runId): Promise<Response>;      // synchronous HTTP response

    sendResult(run, events): Promise<void>;
    sendError(run, error: string): Promise<void>;
    sendClarification(run, question: string): Promise<void>;
    sendApprovalRequest(run, planSteps?: string[], pendingTools?: string[]): Promise<void>;
    sendStreamChunk?(run, event): Promise<void>;             // only if deliveryMode === 'streaming'
    sendScheduledNotification?(task, run, outcome): Promise<void>; // proactive digest, must never throw

    getConfig(tenantId: string): Promise<Record<string, unknown>>;
}
```

Registry is a trivial `Map<ChannelType, ChannelAdapter>` with `register/get/has/list`.
Keep the registry + gateway service + event bus as **process-wide singletons**
(e.g. a `globalThis`-scoped cache in Node, or a DI container elsewhere) so
dev-mode hot reload doesn't spawn duplicate subscriptions.

## 3. Request lifecycle

Inbound routes are one-liners: `POST /gateway/{channel} → gatewayService.handleInbound(channel, req)`.

**`handleInbound`:**
1. `adapter = registry.get(channelType)`
2. `validateRequest(req)` → 401 if false
3. `parseInbound(req)` → `GatewayMessage`
4. If `message.replyContext` present → delegate to `handleResume` (see §6) and return
5. If no `taskDescription` → 400
6. `run = jobService.createRun({ tenantId, source: channelType, taskDescription, trigger: message.channelMeta, ... })`
7. `unsubscribe = notificationRouter.attachToRun(run)` — **subscribe before executing**, so no event is missed
8. `ackResponse = await adapter.sendAck(req, run.runId)` — must be fast (Slack requires ~3s, Discord ~3s)
9. Fire-and-forget: `executeRun(run, eventBus).finally(() => { unsubscribe(); eventBus.cleanup(run.runId); })` — do **not** await this before returning the HTTP response
10. Return `ackResponse`

**`NotificationRouter.attachToRun`** subscribes to the bus and switches on event type:

| Event | Condition | Action |
|---|---|---|
| `run:event` | `adapter.sendStreamChunk` exists AND `deliveryMode === 'streaming'` | `sendStreamChunk(run, event)` |
| `run:completed` | always | fetch full event history → `sendResult(run, events)` |
| `run:failed` | always | `sendError(run, error)` |
| `run:cancelled` | always | `sendError(run, 'Run was cancelled.')` |
| `hil:clarification` | `hilCapabilities.clarification` | `sendClarification(run, question)` |
| — | else | fallback: `sendError(run, "This run needs your input: {dashboardUrl}")` |
| `hil:plan_approval` / `hil:tool_approval` | `hilCapabilities.approvalButtons` | `sendApprovalRequest(run, planSteps, pendingTools)` |
| — | else | same dashboard-link fallback |

Wrap every adapter call in try/catch that only logs — **a broken adapter must
never crash the run**.

**Event bus** — thin wrapper over an in-process `EventEmitter` keyed by
`run:${runId}`, with `emit`, `subscribe` (returns unsubscribe closure),
`subscribeOnce`, `cleanup(runId)`. This is in-memory and single-process; it
does not survive restarts or work across horizontally-scaled instances unless
the whole inbound→ack→execute→notify lifecycle stays pinned to one node. If
your rebuild target runs multiple instances/pods, replace this with a real
broker (Redis pub/sub, SQS + polling, NATS, etc.) behind the same
`emit/subscribe/cleanup` shape — nothing else in the design needs to change.

## 4. Per-channel adapter reference

| Channel | deliveryMode | hilCapabilities | Inbound auth | sendAck behavior | Outbound mechanism |
|---|---|---|---|---|---|
| **Slack** | callback | all true | HMAC-SHA256 over `v0:{ts}:{body}` w/ signing secret, 5-min replay window, `timingSafeEqual` | `{response_type:'ephemeral'}` JSON, 200 | `chat.postMessage` to thread if bot token + threadTs, else `response_url`; approvals use Block Kit buttons |
| **Telegram** | streaming | all true | `x-telegram-bot-api-secret-token` header === configured secret (plain equality) | best-effort `sendMessage`, tracks `message_id` for later edits | `editMessageText` on tracked ack message; approvals use inline keyboard `callback_data` |
| **Discord** | streaming | all true | Ed25519 verify (`tweetnacl`) of `timestamp+body` against app public key | immediate `{type:5}` DEFERRED_CHANNEL_MESSAGE (must respond <3s) | `PATCH /webhooks/{appId}/{token}/messages/@original`, embeds colored by outcome |
| **Jira** | callback | clarification+threaded only (no approval buttons) | shared secret via `Authorization: Bearer`, `x-webhook-secret` header, or `?secret=` query (plain equality) | JSON `{runId, status:'queued'}` | `POST /rest/api/3/issue/{key}/comment` in Atlassian Document Format; approvals are **text instructions** ("Reply APPROVE/REJECT") |
| **Webhook** (generic) | callback | none | HMAC-SHA256 of raw body via `x-webhook-signature`, `timingSafeEqual` (no timestamp/replay check) | JSON `{runId, status:'queued'}` | `POST` to caller-supplied `callbackUrl`, 3 retries w/ exponential backoff (1s/2s/4s); no HIL — dashboard URL embedded for humans |
| **API** (already-trusted callers) | polling | none | presence of `Authorization`/`x-api-key`/session cookie — real check deferred to session layer | `{runId, status:'queued'}` | all `send*` are no-ops; caller polls a status endpoint or subscribes to an SSE stream |

Implementation notes that apply broadly:
- Cache the raw request body in a `WeakMap<Request, string>` — both
  `validateRequest` and `parseInbound` need it, and request bodies are
  single-read streams in most frameworks.
- Resolve **tenant from platform-native IDs**, not from a header you control —
  e.g. Slack's `team_id` needs a reverse-lookup table (`team_id → tenantId`)
  because inbound payloads never carry your internal tenant ID. Cache this
  lookup per-request too.
- The weakest channels (Telegram, Jira, generic webhook without a timestamp)
  rely on secret opacity rather than cryptographic replay protection — that's
  an acceptable tradeoff *if* the secret is high-entropy and delivered only
  over TLS, but call it out explicitly in your own doc if you copy this table.

## 5. Data model

Minimal shape — adapt names to your ORM/DB of choice.

```
TenantConfig(tenantId, configKey, data: json, updatedAt, updatedBy)
  unique(tenantId, configKey)
  -- one row per channel per tenant, e.g. configKey = "agent-ops-slack"
  -- data holds the *IntegrationConfig shape below

SlackWorkspaceLink(teamId unique, tenantId, botUserId?, createdAt, updatedAt)
  -- only needed for platforms whose inbound payload carries a
  -- platform-native workspace/org id instead of your tenant id

Run(id, tenantId, runId, source, status, taskDescription,
    trigger: json,            -- GatewayMessage.channelMeta, stored verbatim
    result: json?, clarification: json?, approvalRequest: json?,
    error?, createdAt, updatedAt, completedAt?, expiresAt)
  unique(tenantId, runId)
  -- status: queued|in_progress|awaiting_input|awaiting_approval|completed|failed|cancelled

RunEvent(id, tenantId, runId, eventType, node, content?, toolName?,
         toolArgs: json?, toolOutput?, metadata: json?, createdAt, expiresAt)

ScheduledTask(..., notification: json)
  -- notification = { type: 'none'|'slack'|'jira'|'telegram', channelId?, chatId?, issueKey?, ... }
  -- destination for proactive sendScheduledNotification digests
```

Per-channel integration config (stored in `TenantConfig.data`):

```ts
interface SlackIntegrationConfig    { signingSecret: string; botToken?: string; enabled: boolean; autoApprove?: boolean; }
interface JiraIntegrationConfig     { webhookSecret: string; baseUrl?: string; userEmail?: string; apiToken?: string; botAccountId?: string; enabled: boolean; autoApprove?: boolean; }
interface DiscordIntegrationConfig  { applicationId: string; publicKey: string; botToken: string; enabled: boolean; autoApprove?: boolean; }
interface TelegramIntegrationConfig { botToken: string; secretToken: string; enabled: boolean; autoApprove?: boolean; }
interface WebhookIntegrationConfig  { webhookSecret: string; enabled: boolean; autoApprove?: boolean; }
```

Per-channel trigger metadata (stored in `Run.trigger`, one shape per channel):

```ts
interface SlackTriggerMeta    { userId; userName?; channelId; channelName?; responseUrl; teamId?; threadTs?; }
interface JiraTriggerMeta     { issueKey; projectKey; reporter; issueType?; webhookId?; }
interface DiscordTriggerMeta  { userId; channelId; guildId?; interactionId; interactionToken; messageId?; }
interface TelegramTriggerMeta { userId: number; chatId: number; messageId?; callbackQueryId?; }
interface WebhookTriggerMeta  { callbackUrl; webhookId?; secret?; }
interface ApiTriggerMeta      { apiKeyId?; callbackUrl?; clientId?; }
```

## 6. Config lifecycle & secret handling

Settings routes follow one pattern for every channel (one GET + one PUT + one
DELETE, sometimes a `/test` route):

- **GET** returns config with secrets masked: `len<=8 ? '********' : first4 + '****' + last4`.
  Only return plaintext behind an explicit `?reveal=1` flag, gated by an
  extra permission check, and audit-log every reveal at high severity.
- **PUT** ("leave blank to keep existing"): `newValue?.trim() || existingValue`
  — never let an empty/masked field overwrite a real secret. Where the
  platform offers one, **live-verify the credential before saving** (e.g.
  Slack's `auth.test`) and reject with 400 on failure — this also gives you
  IDs (team_id, bot_id) to upsert into a reverse-lookup table.
  Distinguish a bare enabled/disabled toggle from a credential change so
  toggling doesn't force re-verification.
- **DELETE** (reset): wipe the config row and any reverse-lookup rows (e.g.
  Slack's `team_id → tenantId` link) so a stale link can't misroute a future
  workspace's requests. Audit at high severity.
- **`/test`**: reuses the same live-verification call without persisting,
  for a UI "Test connection" button.
- Credentials never travel through an async job queue in plaintext — pass
  only IDs (`{tenantId, runId, channel}`) and re-hydrate secrets server-side
  from config storage at execution time.

RBAC: model channel settings as a sub-resource of one higher-level subject
(e.g. `Agent`/`AIOps`) rather than a distinct permission per channel —
`authorize('update'|'delete', 'Agent')` covers all six adapters' settings
routes uniformly.

## 7. HIL / resume flow

Channel-triggered replies (button click, thread reply, "APPROVE" comment) are
**not** a separate endpoint — they re-enter the *same* inbound route as a new
message, disambiguated by whether `parseInbound` populated `replyContext`.

`handleResume(message)` dispatches on `replyContext.action`:

- **`approve`**: look up the run in `awaiting_approval` state by `runId`
  (trust comes from whatever `validateRequest` already verified for that
  channel — e.g. the button payload's HMAC/signature — not a user session) →
  `attachToRun` → fire-and-forget resume-from-checkpoint → ack.
- **`reject`**: flip status to `cancelled`, record an event, ack. No executor
  re-entry.
- **`clarification_response`**: append the reply to the task description as
  extra context, flip status back to `queued`, `attachToRun` → fire-and-forget
  full re-execution → ack.

Keep a **second, independently-authenticated resume path** for a logged-in
dashboard/web UI (session-based, not channel-signature-based) hitting REST
endpoints like `POST /runs/{id}/approve|resume|cancel`. It should reuse the
exact same run-service/executor functions and emit onto the same event bus —
so if a human approves from the dashboard, the *originating* channel still
gets notified via the router. This path additionally needs an ownership check
(`run.tenantId === session.tenantId`) since there's no per-request adapter
validating platform-native identity.

## 8. Adding a new channel (recipe)

No executor or router changes needed:

1. **Adapter** — new file implementing `ChannelAdapter`.
2. **Register** — `registry.register(new XAdapter())` at startup.
3. **Config + trigger types** — add `XIntegrationConfig` / `XTriggerMeta`;
   extend the `source` enum/check-constraint in your DB schema.
4. **Settings API** — GET (masked) / PUT (validate + live-verify + upsert
   any reverse-lookup) / DELETE (wipe + audit).
5. **Gateway route** — one-liner: `POST /gateway/x → gatewayService.handleInbound('x', req)`.
6. **Settings UI** — form + connection-test button.
7. **Wire into whatever surfaces a "connected channels" list.**

Set `deliveryMode` and `hilCapabilities` honestly — the router's fallback
behavior (dashboard-link-via-sendError) depends entirely on these being
accurate; declaring a capability you don't implement will silently break HIL
for that channel.

## 9. What to change for a from-scratch, horizontally-scaled rebuild

- Swap the in-process `EventEmitter` event bus for a real broker (Redis
  pub/sub or streams, SQS + a fan-out worker, NATS) — keep the same
  `emit(event) / subscribe(runId, handler) / cleanup(runId)` surface so
  nothing above it changes.
- If ack + execute might land on different instances behind a load balancer,
  make sure whichever instance calls `sendAck` also owns the fire-and-forget
  execution, or hand off execution to a durable queue immediately after ack
  rather than an in-process `.finally()`.
- Consider signing your *outbound* dashboard-fallback links (the URL embedded
  when a channel lacks HIL capability) so they can't be replayed/guessed.
- Add a timestamp + replay window to any adapter you build that currently
  only does plain-secret or non-timestamped HMAC comparison (Telegram, Jira,
  generic Webhook above) if replay protection matters for your threat model.

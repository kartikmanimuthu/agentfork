# WhatsApp Integration Design Spec

**Date:** 2026-05-17
**Status:** Approved
**Branch:** whatsapp-agent

## Overview

Enterprise-grade WhatsApp Business Platform (Cloud API) integration for the multi-tenant chatbot platform. Tenants connect their own WhatsApp Business Accounts via Meta's Embedded Signup, configure routing strategies to direct conversations to specific agents (simple or graph), and manage message templates for proactive outreach.

## Requirements

- Meta Cloud API with Embedded Signup (tenant-owned WABAs)
- Hybrid interaction model: stateful sessions + utility commands
- One number → multiple agents with configurable routing (menu / AI intent / keyword / time-based)
- Media support: text, images, documents (PDF)
- Inbound conversations + template notifications (24h window aware)
- No human handoff in v1
- Webhook endpoints in `apps/web-ui` (inline processing via `waitUntil`)
- Separate WhatsApp-specific data models
- High volume / enterprise-ready (hundreds of tenants, tens of thousands of messages/day)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Meta Cloud API                                             │
│  (Webhooks: messages, statuses, template events)            │
└──────────────────────────┬──────────────────────────────────┘
                           │ POST /api/webhooks/whatsapp
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  apps/web-ui/app/api/webhooks/whatsapp/route.ts             │
│  - Validate signature → 200 immediately                     │
│  - Fire-and-forget: process message via waitUntil()         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  libs/whatsapp/                                             │
│  ├── client/          (Meta Graph API client)               │
│  ├── webhook/         (Signature validation + parsing)      │
│  ├── router/          (Configurable routing framework)      │
│  ├── session/         (Session management + commands)       │
│  ├── media/           (Upload/download media)               │
│  ├── templates/       (Template sync + dispatch)            │
│  ├── concurrency/     (Locks, rate limits, circuit breaker) │
│  └── processor/       (Orchestration)                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  libs/agent-studio/                                         │
│  (Existing agent execution — simple + graph)                │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Meta Cloud API (Send message response)                     │
└─────────────────────────────────────────────────────────────┘
```

## Data Model

### WhatsAppAccount

Stores tenant's connected WhatsApp Business Account.

| Field | Type | Notes |
|-------|------|-------|
| id | cuid | PK |
| tenantId | String | FK → Tenant |
| wabaId | String | WhatsApp Business Account ID from Meta |
| phoneNumberId | String | Meta phone number ID (unique) |
| displayPhone | String | Human-readable phone number |
| displayName | String | Business display name |
| accessToken | String | AES-256-GCM encrypted permanent token |
| webhookSecret | String | Per-account verification token |
| status | String | active / suspended / disconnected |
| qualityRating | String? | GREEN / YELLOW / RED (from Meta) |
| messagingLimit | String? | TIER_1K / TIER_10K / TIER_100K / UNLIMITED |

Indexes: `[tenantId]`, unique `[tenantId, wabaId]`, unique `[phoneNumberId]`

### WhatsAppRouting

Per-account routing configuration.

| Field | Type | Notes |
|-------|------|-------|
| id | cuid | PK |
| accountId | String | FK → WhatsAppAccount (unique, 1:1) |
| strategy | String | menu / ai_intent / keyword / time_based |
| config | Json | Strategy-specific configuration |
| fallbackAgentId | String? | Agent when routing fails |

### WhatsAppRoutingRule

Individual routing rules within a strategy.

| Field | Type | Notes |
|-------|------|-------|
| id | cuid | PK |
| routingId | String | FK → WhatsAppRouting |
| agentId | String | Target agent |
| priority | Int | Lower = higher priority |
| condition | Json | `{ type: "keyword", value: "sales" }` or `{ type: "time", start: "09:00", end: "17:00" }` |
| isActive | Boolean | Enable/disable without deleting |

### WhatsAppSession

Tracks active conversations with 24h window awareness.

| Field | Type | Notes |
|-------|------|-------|
| id | cuid | PK |
| accountId | String | FK → WhatsAppAccount |
| contactPhone | String | End-user's wa_id |
| contactName | String? | Profile name from WhatsApp |
| agentId | String | Currently active agent |
| state | String | active / expired / closed |
| context | Json | Agent conversation state/memory |
| lastMessageAt | DateTime | Tracks 24h window |
| windowExpiresAt | DateTime | lastMessageAt + 24h |
| metadata | Json? | Extensible metadata |

Unique constraint: `[accountId, contactPhone, state]` (one active session per contact)

### WhatsAppMessage

All messages (inbound + outbound) with delivery lifecycle.

| Field | Type | Notes |
|-------|------|-------|
| id | cuid | PK |
| accountId | String | FK → WhatsAppAccount |
| sessionId | String? | FK → WhatsAppSession |
| waMessageId | String | Meta's message ID (unique, for dedup) |
| direction | String | inbound / outbound |
| contactPhone | String | End-user's phone |
| type | String | text / image / document / template / interactive |
| content | Json | Type-specific payload |
| status | String | received / sent / delivered / read / failed |
| statusTimestamp | DateTime? | Last status update time |
| errorCode | String? | Meta error code on failure |
| errorMessage | String? | Human-readable error |

Indexes: `[accountId, contactPhone, createdAt]`, `[sessionId, createdAt]`, unique `[waMessageId]`

### WhatsAppTemplate

Synced message templates from Meta.

| Field | Type | Notes |
|-------|------|-------|
| id | cuid | PK |
| accountId | String | FK → WhatsAppAccount |
| name | String | Template name registered with Meta |
| language | String | e.g., "en_US" |
| category | String | UTILITY / MARKETING / AUTHENTICATION |
| status | String | APPROVED / PENDING / REJECTED |
| components | Json | Header, body, footer, buttons |

Unique constraint: `[accountId, name, language]`

## Routing Framework

### Flow

```
Incoming Message
      │
      ▼
Session exists (active + same contact)?
      │
  yes─┤──▶ Route to session's current agent (unless command)
      │
  no──▼
Load routing strategy for account
      │
      ▼
Execute strategy router
      │
      ▼
Result: resolved(agentId) | prompt(interactiveMessage) | fallback(agentId, reason)
      │
      ▼
Create WhatsAppSession → Execute Agent
```

### Router Interface

```typescript
interface WhatsAppRouter {
  route(ctx: RoutingContext): Promise<RoutingResult>;
}

interface RoutingContext {
  message: ParsedWhatsAppMessage;
  account: WhatsAppAccount;
  routing: WhatsAppRouting;
  rules: WhatsAppRoutingRule[];
}

type RoutingResult =
  | { type: 'resolved'; agentId: string }
  | { type: 'prompt'; interactiveMessage: InteractiveMessage }
  | { type: 'fallback'; agentId: string; reason: string };
```

### Strategy Behaviors

| Strategy | First message | Subsequent |
|----------|--------------|------------|
| `menu` | Sends interactive button/list message | User picks option → maps to agent |
| `keyword` | Scans message for configured keywords | First match wins, else fallback |
| `ai_intent` | Sends message to lightweight LLM classifier | Returns agent ID from intent map |
| `time_based` | Checks current time against rules | Routes to scheduled agent, else fallback |

### Commands (Hybrid Mode)

Intercepted before routing by `CommandHandler`:

| Command | Behavior |
|---------|----------|
| `/reset` | Closes current session, starts fresh routing |
| `/switch <agent>` | Changes active agent mid-conversation |
| `/help` | Lists available agents/commands |

## Webhook Processing

### Flow

1. **Verify** — Validate `X-Hub-Signature-256` (HMAC-SHA256 with app secret). Reject with 401 if invalid.
2. **Parse** — Extract `entry[].changes[]`, categorize into message/status/error events.
3. **Respond 200** — Immediately return to Meta (must be < 5s).
4. **Process via `waitUntil()`** — Fire-and-forget async processing:

**Message events:**
- Lookup WhatsAppAccount by phoneNumberId
- Deduplicate (check waMessageId uniqueness)
- Download media if present (to S3)
- Check for commands (/reset, /switch, /help)
- Find or create session (check 24h window)
- Route to agent (if new session)
- Execute agent (simple or graph)
- Send response via Meta API
- Persist messages (inbound + outbound)

**Status events:**
- Update WhatsAppMessage.status (sent → delivered → read)

**Error events:**
- Log error, update message status to failed

### Enterprise Concerns

| Concern | Solution |
|---------|----------|
| Deduplication | Check `waMessageId` uniqueness before processing |
| Rate limiting | Per-account semaphore — respect Meta's per-number throughput tiers |
| Circuit breaker | Back off on repeated Meta API 5xx responses, queue for retry |
| Timeout safety | 25s agent execution deadline; send "still thinking..." if exceeded |
| Concurrency | Per-contact lock (Redis advisory) to prevent out-of-order processing |
| Observability | Pino structured logs: `{ tenantId, accountId, contactPhone, waMessageId, agentId, durationMs }` |

### Slow Agent Pattern

```typescript
const result = await Promise.race([
  executeAgent(session, message),
  timeout(25_000),
]);

if (result === 'timeout') {
  await sendWhatsAppMessage(account, contact, { text: "Working on that, one moment..." });
  const finalResult = await executeAgent(session, message);
  await sendWhatsAppMessage(account, contact, finalResult);
} else {
  await sendWhatsAppMessage(account, contact, result);
}
```

## Embedded Signup & Onboarding

### Flow

1. Tenant clicks "Connect WhatsApp" in dashboard
2. Meta's Embedded Signup JS SDK launches in-browser popup
3. Tenant logs into Facebook Business, creates/selects WABA, registers phone, grants permissions
4. Callback returns authorization code to app
5. `POST /api/whatsapp/connect`:
   - Exchange code for permanent access token
   - Fetch WABA details + phone number info from Meta API
   - Subscribe app to WABA webhooks
   - Register phone number for messaging
   - Create WhatsAppAccount record (encrypt token)
   - Create default WhatsAppRouting (fallback agent)
   - Redirect to WhatsApp config page

### Meta App Prerequisites (One-Time)

- Facebook App with WhatsApp product enabled
- Business Verification completed
- App set as "Tech Provider" type
- Webhook URL registered: `https://<domain>/api/webhooks/whatsapp`
- Required permissions: `whatsapp_business_management`, `whatsapp_business_messaging`

### Security

- Access tokens encrypted at rest (AES-256-GCM)
- Webhook signature validation per request
- Per-tenant webhook secret for additional verification
- Scoped API access — tenants only see their own WABA data

## Library Structure

```
libs/whatsapp/src/
├── index.ts                 // Public exports
├── env.ts                   // T3 Env validation
├── client/
│   ├── meta-api.ts          // Graph API client
│   └── types.ts             // Meta API request/response types
├── webhook/
│   ├── signature.ts         // HMAC-SHA256 verification
│   ├── parser.ts            // Raw payload → typed events
│   └── types.ts             // Webhook payload types
├── router/
│   ├── router.interface.ts  // WhatsAppRouter interface + types
│   ├── menu-router.ts       // Interactive message routing
│   ├── keyword-router.ts    // Keyword matching
│   ├── ai-intent-router.ts  // LLM-based intent classification
│   ├── time-router.ts       // Time-based rules
│   └── factory.ts           // Strategy → router instance
├── session/
│   ├── session-manager.ts   // Find/create/expire sessions
│   └── command-handler.ts   // /reset, /switch, /help
├── media/
│   ├── downloader.ts        // Download from Meta CDN → S3
│   └── uploader.ts          // Upload to Meta for outbound
├── templates/
│   ├── template-sync.ts     // Sync templates from Meta API
│   └── template-sender.ts   // Send template messages
├── concurrency/
│   ├── contact-lock.ts      // Per-contact processing lock
│   ├── rate-limiter.ts      // Per-account rate limiting
│   └── circuit-breaker.ts   // Meta API failure backoff
└── processor/
    └── message-processor.ts // Orchestration entry point
```

### Dependencies

| Lib | Usage |
|-----|-------|
| `@chatbot/shared` | Prisma client, Pino logger, tenant config |
| `@chatbot/ai` | Provider factory (for AI intent router) |
| `@chatbot/agent-studio` | Agent execution (simple + graph) |

## Dashboard Pages

| Route | Purpose |
|-------|---------|
| `/settings/channels/whatsapp` | Connect/disconnect WABA, view status & quality |
| `/settings/channels/whatsapp/routing` | Configure routing strategy, map agents to rules |
| `/settings/channels/whatsapp/templates` | Manage message templates (sync + create) |
| `/settings/channels/whatsapp/analytics` | Message volume, response times, delivery rates |

## API Routes (web-ui)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/webhooks/whatsapp` | GET | Meta webhook verification (challenge response) |
| `/api/webhooks/whatsapp` | POST | Receive webhook events |
| `/api/whatsapp/connect` | POST | Exchange Embedded Signup code for token, provision account |
| `/api/whatsapp/disconnect` | POST | Disconnect WABA, revoke token |
| `/api/whatsapp/accounts` | GET | List tenant's connected accounts |
| `/api/whatsapp/accounts/[id]/routing` | GET/PUT | Get/update routing config |
| `/api/whatsapp/accounts/[id]/templates` | GET | List templates |
| `/api/whatsapp/accounts/[id]/templates/sync` | POST | Sync templates from Meta |
| `/api/whatsapp/accounts/[id]/templates/send` | POST | Send template message |
| `/api/whatsapp/accounts/[id]/analytics` | GET | Message stats |

## Out of Scope (v1)

- Human handoff / live agent escalation
- Audio and video media
- WhatsApp Flows (structured forms)
- Broadcast / bulk messaging campaigns
- Read receipts sent back to users (blue ticks)
- Multi-device support per number
- WhatsApp Commerce (catalog, cart)

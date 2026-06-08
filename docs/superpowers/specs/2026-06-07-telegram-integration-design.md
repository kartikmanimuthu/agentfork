# Telegram Bot Integration — Design Spec

**Date:** 2026-06-07
**Status:** Approved for implementation

---

## Overview

Add Telegram as a second messaging channel alongside WhatsApp. Tenants connect their own Telegram bots (created via BotFather) and assign graph agents to handle conversations. The integration surfaces as three new graph nodes (`telegram_trigger`, `telegram_send`, `telegram_send_buttons`) and a settings page for managing connected bots.

The architecture mirrors `libs/whatsapp` exactly — same patterns, same separation of concerns, same graph execution model. grammY is used as the Telegram API client only; all routing, session management, and processing logic lives in our own code.

---

## Goals

- Tenants can connect multiple Telegram bots per tenant (one bot = one `TelegramAccount`)
- Graph agents work the same way as WhatsApp: `telegram_trigger` → LLM/condition nodes → `telegram_send` / `telegram_send_buttons`
- Inline keyboard buttons (Telegram's interactive button menus) are first-class
- Bots respond in private chats (always) and groups (only when @mentioned or /command sent to bot)
- Built-in commands: `/start`, `/reset`, `/help`
- Connect flow: paste BotFather token → webhook registered automatically — no Meta dashboard, no OAuth
- No 24-hour messaging window (Telegram has no such constraint)

---

## Architecture

### Request flow

```
User sends Telegram message
        ↓
POST /api/webhooks/telegram/[accountId]     ← Next.js route
        ↓
Validate X-Telegram-Bot-Api-Secret-Token header
        ↓
parseWebhookPayload() → ParsedTelegramEvent
        ↓
TelegramMessageProcessor.processMessageEvent()
        ↓
TelegramSessionManager.findOrCreate(accountId, chatId)
        ↓
Router selects agentId (keyword / menu / ai_intent / time_based)
        ↓
TelegramAgentExecutor.execute()
        ↓
GraphExecutor.executeFromState() — injects tg_* channels into graph state
        ↓
[telegram_trigger] → [llm] → [telegram_send / telegram_send_buttons]
        ↓
TelegramBotClient.sendMessage() via grammY
```

### Library choice

**grammY** (`grammy` npm package) is used as the Telegram API client layer only:
- `bot.telegram.sendMessage()`, `sendPhoto()`, `sendDocument()`, `sendVideo()`
- `bot.telegram.sendMessage()` with `reply_markup` for inline keyboards
- `bot.telegram.answerCallbackQuery()` — dismisses button loading spinner
- `bot.telegram.setWebhook()` / `deleteWebhook()` — called on connect/disconnect
- `bot.telegram.getMe()` — called on connect to fetch bot username and display name

grammY is **not** used for webhook handling, session management, routing, or middleware. Those stay in our own code.

### Webhook URL strategy

Each `TelegramAccount` gets a unique webhook URL:
```
POST /api/webhooks/telegram/[accountId]
```

On connect, we call:
```typescript
bot.telegram.setWebhook(
  `https://{domain}/api/webhooks/telegram/${account.id}`,
  { secret_token: account.webhookSecret }
)
```

Telegram sends `X-Telegram-Bot-Api-Secret-Token: {webhookSecret}` on every request. We validate this header before processing. If it doesn't match the stored `webhookSecret`, we return `403`.

This means each bot has its own endpoint — no shared-route discriminator needed, unlike WhatsApp where Meta enforces a single URL per app.

---

## Data Models

### New Prisma models

```prisma
model TelegramAccount {
  id            String   @id @default(cuid())
  tenantId      String
  botToken      String   // AES-256-GCM encrypted via EncryptionService
  botUsername   String   // @username, fetched via getMe() on connect
  botName       String   // display name, fetched via getMe() on connect
  webhookSecret String   // crypto.randomUUID(), sent to Telegram as secret_token
  status        String   @default("active") // active | inactive
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  tenant        Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  routingConfig TelegramRouting?
  sessions      TelegramSession[]
  messages      TelegramMessage[]

  @@map("telegram_accounts")
}

model TelegramRouting {
  id              String   @id @default(cuid())
  accountId       String   @unique
  strategy        String   @default("keyword") // keyword | menu | ai_intent | time_based
  config          Json     @default("{}")
  fallbackAgentId String?

  account TelegramAccount       @relation(fields: [accountId], references: [id], onDelete: Cascade)
  rules   TelegramRoutingRule[]

  @@map("telegram_routing")
}

model TelegramRoutingRule {
  id        String   @id @default(cuid())
  routingId String
  keyword   String
  agentId   String
  priority  Int      @default(0)
  createdAt DateTime @default(now())

  routing TelegramRouting @relation(fields: [routingId], references: [id], onDelete: Cascade)

  @@map("telegram_routing_rules")
}

model TelegramSession {
  id            String   @id @default(cuid())
  accountId     String
  tenantId      String
  chatId        String   // Telegram chat_id — works for both DMs and groups
  chatType      String   // private | group | supergroup | channel
  agentId       String
  context       Json     @default("{}")
  status        String   @default("active") // active | closed
  lastMessageAt DateTime
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  // No windowExpiresAt — Telegram has no 24-hour messaging constraint

  account  TelegramAccount  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  messages TelegramMessage[]

  @@unique([accountId, chatId])
  @@map("telegram_sessions")
}

model TelegramMessage {
  id          String   @id @default(cuid())
  accountId   String
  sessionId   String?
  tgMessageId String   // Telegram's message_id, used for deduplication
  direction   String   // inbound | outbound
  chatId      String
  type        String   // text | photo | document | voice | video | sticker | callback_query
  content     Json     // { text?, fileId?, caption?, callbackData? }
  status      String   @default("received") // received | sent | failed
  createdAt   DateTime @default(now())

  account TelegramAccount  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  session TelegramSession? @relation(fields: [sessionId], references: [id], onDelete: SetNull)

  @@unique([tgMessageId, accountId]) // deduplication key
  @@map("telegram_messages")
}
```

### Tenant model addition

```prisma
// Add to existing Tenant model:
telegramAccounts TelegramAccount[]
```

---

## `libs/telegram` Structure

```
libs/telegram/
  src/
    client/
      telegram-client.ts       # TelegramBotClient — grammY wrapper
      types.ts                 # Typed Telegram API shapes

    webhook/
      parser.ts                # Raw Update → ParsedTelegramEvent
      validator.ts             # X-Telegram-Bot-Api-Secret-Token validation
      types.ts                 # ParsedTelegramEvent union type

    processor/
      message-processor.ts     # Main orchestrator
      agent-executor.ts        # GraphExecutor bridge
      callback-processor.ts    # Handles callback_query (button presses)

    session/
      session-manager.ts       # find/create/refresh TelegramSession
      command-handler.ts       # /start /reset /help

    router/
      factory.ts               # createRouter(strategy)
      keyword-router.ts
      menu-router.ts
      time-router.ts
      ai-intent-router.ts
      router.interface.ts

    concurrency/
      contact-lock.ts          # Per-chatId Redis advisory lock
      circuit-breaker.ts       # Tracks Telegram API failures

    factory.ts                 # createTelegramMessageProcessor()
    env.ts                     # T3 Env — REDIS_URL (optional, shared with WhatsApp)
    index.ts                   # Public exports

  vitest.config.ts
  tsconfig.json
  package.json
```

---

## Graph Nodes

### `telegram_trigger`

**Role:** Entry point for any Telegram-triggered graph. Reads pre-injected `tg_*` channels from graph state, validates required fields exist, optionally remaps channel names.

**State channels populated by `TelegramAgentExecutor` before the graph runs:**

| Channel | Type | Description |
|---|---|---|
| `tg_chat_id` | string | Chat ID — used to send replies |
| `tg_sender_id` | string | Telegram user ID of the sender |
| `tg_sender_username` | string | @username (may be empty) |
| `tg_message_text` | string | Message text (empty for media-only messages) |
| `tg_message_type` | string | text \| photo \| document \| voice \| video \| sticker |
| `tg_file_id` | string \| null | Telegram file_id for media messages |
| `tg_chat_type` | string | private \| group \| supergroup |
| `tg_message_id` | string | Original Telegram message_id (for reply-to) |
| `tg_callback_data` | string \| null | Set when triggered by inline button press |
| `tg_account_id` | string | Internal TelegramAccount.id |
| `tg_session_id` | string | Internal TelegramSession.id |

**Config options (all optional):**
- `channelMap` — rename any `tg_*` channel to a custom name for downstream nodes

**Executor behaviour:**
1. Validates `tg_chat_id` and `tg_account_id` exist — returns error if missing
2. Writes all `tg_*` values to `stateUpdates` (applying channelMap if configured)
3. Returns `status: 'success'`

---

### `telegram_send`

**Role:** Sends a text or media message to the chat. Looks up the `TelegramAccount` by `tg_account_id`, decrypts the bot token via `EncryptionService`, instantiates `TelegramBotClient`, sends the message.

**Config:**

| Field | Required | Description |
|---|---|---|
| `messageType` | Yes | text \| photo \| document \| video \| voice |
| `messageChannel` | Yes | State channel holding the message text or file_id/URL |
| `captionChannel` | No | State channel holding caption for media messages |
| `replyToChannel` | No | State channel holding a message_id to reply to |

**Executor behaviour:**
1. Reads `tg_chat_id` and `tg_account_id` from channels
2. Looks up `TelegramAccount`, decrypts `botToken`
3. Instantiates `TelegramBotClient(botToken)`
4. Calls appropriate send method based on `messageType`
5. Stores outbound message in `TelegramMessage` table
6. Returns `stateUpdates: { tg_last_sent_message_id: messageId }`

**Short-circuit:** If `tg_last_sent_message_id` is already set in state (a prior send node ran), `MessageProcessor` skips its own outbound send — same pattern as WhatsApp.

---

### `telegram_send_buttons`

**Role:** Sends a message with an inline keyboard. Supports both static (configured in the node) and dynamic (from a state channel) button layouts.

**Config:**

| Field | Required | Description |
|---|---|---|
| `messageChannel` | Yes | State channel holding the message text shown above buttons |
| `buttons` | Either/or | Static JSON — array of button rows: `[[{text, callbackData}]]` |
| `buttonsChannel` | Either/or | State channel holding buttons JSON (for dynamic/LLM-generated buttons). If both `buttons` and `buttonsChannel` are set, `buttonsChannel` takes precedence. |

**Button shape:**
```typescript
type InlineButton = { text: string; callbackData: string }
type ButtonRow = InlineButton[]
type ButtonLayout = ButtonRow[] // rows of buttons
```

**Executor behaviour:**
1. Reads `tg_chat_id` and `tg_account_id` from channels
2. Resolves button layout from `buttons` config or `buttonsChannel` (parses JSON if string)
3. Builds grammY `InlineKeyboard` from the layout
4. Calls `client.sendMessageWithButtons(chatId, text, keyboard)`
5. Returns `stateUpdates: { tg_last_sent_message_id: messageId }`

**Callback flow (when user clicks a button):**
- Telegram sends `callback_query` event to `/api/webhooks/telegram/[accountId]`
- `CallbackProcessor` answers the query immediately (removes loading spinner)
- Finds/creates session for the chatId
- Routes to agent with `tg_callback_data` set to the button's `callbackData` value
- Graph runs again from `telegram_trigger`, this time with `tg_callback_data` populated
- A `condition` node downstream can branch on `tg_callback_data`

---

## Connect / Disconnect Flow

### `POST /api/telegram/connect`

Request: `{ botToken: string }`

Steps:
1. Validate `botToken` format (contains `:`)
2. Call `bot.telegram.getMe()` — get `botUsername`, `botName` (fail fast: return 502 if unreachable)
3. Generate `id = cuid()`, `webhookSecret = crypto.randomUUID()`
4. Construct `webhookUrl = https://{domain}/api/webhooks/telegram/${id}`
5. Call `bot.telegram.setWebhook(webhookUrl, { secret_token: webhookSecret })` (fail fast: return 502 if fails — no DB record created yet)
6. Encrypt `botToken` via `EncryptionService`
7. In a single Prisma transaction: create `TelegramAccount` (with the pre-generated `id`) + create `TelegramRouting`
8. Return `{ id, botUsername, botName, status: 'active' }`

**Ordering rationale:** `setWebhook` is called before writing to the DB. If Telegram rejects the webhook (bad token, network issue), no orphaned DB record is left behind.

### `POST /api/telegram/disconnect`

Request: `{ accountId: string }`

Steps:
1. Look up account, decrypt bot token
2. Call `bot.telegram.deleteWebhook()`
3. Set `account.status = 'inactive'`
4. Return `{ status: 'ok' }`

---

## Webhook Route

**File:** `apps/web-ui/app/api/webhooks/telegram/[accountId]/route.ts`

```
POST /api/webhooks/telegram/[accountId]

1. Read accountId from path
2. Validate X-Telegram-Bot-Api-Secret-Token header
   → 403 if missing or doesn't match account.webhookSecret
3. Parse raw body → parseWebhookPayload(body)
4. Return 200 { status: 'ok' } immediately
5. Process async:
   - message event → TelegramMessageProcessor.processMessageEvent()
   - callback_query event → CallbackProcessor.processCallbackQuery()
   - edited_message → ignored (log only)
```

---

## Message Processing Detail

### `TelegramMessageProcessor.processMessageEvent()`

```
1. Look up TelegramAccount by accountId
2. Deduplication: check TelegramMessage by (tgMessageId, accountId) — skip if exists
3. Acquire per-chatId contact lock — skip if locked
4. Check circuit breaker — skip if open
5. Store inbound TelegramMessage in DB

6. Group chat filter:
   - If chatType !== 'private':
     → discard unless message mentions @botUsername OR starts with /command

7. Check for built-in commands (/start, /reset, /help)
   → handle and return early if matched

8. Find or create TelegramSession (accountId, chatId)
9. Router evaluates rules → returns agentId
10. TelegramAgentExecutor.execute(agentId, message, context)

11. If agentResponse.text is not empty:
    → TelegramBotClient.sendMessage(chatId, agentResponse.text)
    → Store outbound TelegramMessage

12. Refresh session.lastMessageAt
13. Release contact lock
```

---

## Group Chat Handling

In private chats (`chatType === 'private'`): process every message.

In groups/supergroups: only process if **any** of:
- Message text starts with `/command` (with or without `@botUsername` suffix)
- Message text contains `@{botUsername}` mention
- Message is a reply to one of the bot's own messages (`reply_to_message.from.is_bot === true`)

All other group messages: return `200 OK`, store nothing, run nothing.

---

## Built-in Commands

Handled by `CommandHandler` before the agent runs:

| Command | Behaviour |
|---|---|
| `/start` | Creates session if none exists. Sends a configurable welcome message (stored in `TelegramRouting.config.welcomeMessage`). Does not run graph. |
| `/reset` | Closes current session (`status: 'closed'`). Sends "Session reset. Send a message to start a new conversation." |
| `/help` | Sends "Available commands: /start /reset /help" |

---

## `TelegramAgentExecutor` — Graph Bridge

Mirrors `WhatsAppAgentExecutor.executeGraphAgent()` exactly:

```typescript
const initialState: GraphState = {
  channels: {
    tg_chat_id:          context.tg_chat_id,
    tg_sender_id:        context.tg_sender_id,
    tg_sender_username:  context.tg_sender_username ?? '',
    tg_message_text:     message.text ?? '',
    tg_message_type:     context.tg_message_type ?? 'text',
    tg_file_id:          context.tg_file_id ?? null,
    tg_chat_type:        context.tg_chat_type ?? 'private',
    tg_message_id:       context.tg_message_id ?? '',
    tg_callback_data:    context.tg_callback_data ?? null,
    tg_account_id:       context.tg_account_id,
    tg_session_id:       context.tg_session_id,
  },
  currentNodeId: entryNode.id,
  metadata: { tenantId, executionId: crypto.randomUUID() },
  trace: [],
};

const finalState = await executor.executeFromState(graphDef, initialState, initialState.metadata);

// If a telegram_send or telegram_send_buttons node ran inside the graph,
// tg_last_sent_message_id will be set — return empty text to skip outer send
if (finalState.channels['tg_last_sent_message_id']) return { text: '' };

return {
  text: String(
    finalState.channels['response'] ??
    finalState.channels['llm_output'] ??
    ''
  )
};
```

Entry node selection: prefers node with `type === 'telegram_trigger'`, falls back to node with no incoming edges.

---

## Node Registry Updates

### `libs/agent-studio/src/types/nodes.ts`

New config interfaces:
```typescript
export interface TelegramTriggerNodeConfig {
  type: 'telegram_trigger';
  channelMap?: {
    chatIdChannel?: string;
    messageTextChannel?: string;
    messageTypeChannel?: string;
    fileIdChannel?: string;
    callbackDataChannel?: string;
  };
}

export interface TelegramSendNodeConfig {
  type: 'telegram_send';
  messageType: 'text' | 'photo' | 'document' | 'video' | 'voice';
  messageChannel: string;
  captionChannel?: string;
  replyToChannel?: string;
}

export interface TelegramSendButtonsNodeConfig {
  type: 'telegram_send_buttons';
  messageChannel: string;
  buttons?: Array<Array<{ text: string; callbackData: string }>>;
  buttonsChannel?: string;
}
```

`NodeType` union extended with: `'telegram_trigger' | 'telegram_send' | 'telegram_send_buttons'`

`NodeConfig` union extended with the three new config types.

### `libs/agent-studio/src/registry/node-registry.ts`

Three new `NodeDefinition` entries:

```typescript
{
  type: 'telegram_trigger',
  label: 'Telegram Trigger',
  description: 'Entry point for Telegram messages. Exposes sender, text, file, and callback data.',
  category: 'trigger',
  defaultConfig: { type: 'telegram_trigger' },
},
{
  type: 'telegram_send',
  label: 'Telegram Send',
  description: 'Send a text, photo, document, or video to the Telegram chat.',
  category: 'action',
  defaultConfig: { type: 'telegram_send', messageType: 'text', messageChannel: 'response' },
},
{
  type: 'telegram_send_buttons',
  label: 'Telegram Buttons',
  description: 'Send a message with inline keyboard buttons. Handles user button clicks.',
  category: 'action',
  defaultConfig: {
    type: 'telegram_send_buttons',
    messageChannel: 'response',
    buttons: [[{ text: 'Yes', callbackData: 'yes' }, { text: 'No', callbackData: 'no' }]],
  },
},
```

---

## Settings UI

**New page:** `apps/web-ui/app/(dashboard)/settings/channels/telegram/page.tsx`

- Lists all connected `TelegramAccount` records for the current tenant
- Each account shown as a card: bot avatar (Telegram default), `@botUsername`, display name, status badge, Disconnect button
- "Connect Bot" button opens a dialog with a single `Input` for the bot token
- On submit: `POST /api/telegram/connect` → success shows the new bot card
- Error states: invalid token format, bot already connected, Telegram API unreachable

**New config forms (graph canvas):**
- `telegram-trigger-node-form.tsx` — info card showing available `tg_*` channels + optional channel remapping fields
- `telegram-send-node-form.tsx` — messageType Select, messageChannel Input, optional captionChannel, replyToChannel
- `telegram-send-buttons-node-form.tsx` — messageChannel Input, visual button builder (add/remove rows and buttons), optional buttonsChannel Input

All forms use `@tanstack/react-form` + Zod validation + shadcn/ui components.

---

## Error Handling

| Scenario | Handling |
|---|---|
| Invalid `X-Telegram-Bot-Api-Secret-Token` | 403, log warn, no processing |
| Duplicate `tgMessageId` | Skip silently (idempotency) |
| `TelegramAccount` not found for accountId | 200 OK (avoid Telegram retries), log error |
| `TelegramBotClient` API failure | Circuit breaker records failure; log error with `{ accountId, chatId }` |
| Circuit breaker open | Skip processing, return 200 |
| Bot token decryption failure | Log error, skip — do not crash webhook handler |
| Graph execution error | Log error, fall back to empty response (no reply sent) |
| `getMe()` fails on connect | Return 502 to settings UI, do not create account |
| `setWebhook()` fails on connect | Return 502, do not create account (atomic: create only after webhook confirmed) |

---

## Security

- **Bot token at rest:** AES-256-GCM encrypted via `EncryptionService`, requires `ENCRYPTION_KEY` env var
- **Webhook validation:** `X-Telegram-Bot-Api-Secret-Token` header checked on every inbound request
- **No bot token in URLs:** Webhook URL uses internal `accountId` (cuid), never the token
- **Contact locks:** Per-chatId Redis advisory lock prevents race conditions on the same conversation
- **Deduplication:** `@@unique([tgMessageId, accountId])` prevents duplicate processing on Telegram retries
- **RBAC:** Connect/disconnect routes require `authorize('create'/'delete', 'TenantConfig')` — same as WhatsApp

---

## Key Files

| Layer | File |
|---|---|
| Webhook route | `apps/web-ui/app/api/webhooks/telegram/[accountId]/route.ts` |
| Connect API | `apps/web-ui/app/api/telegram/connect/route.ts` |
| Disconnect API | `apps/web-ui/app/api/telegram/disconnect/route.ts` |
| Settings UI | `apps/web-ui/app/(dashboard)/settings/channels/telegram/page.tsx` |
| Telegram client | `libs/telegram/src/client/telegram-client.ts` |
| Message processor | `libs/telegram/src/processor/message-processor.ts` |
| Agent executor | `libs/telegram/src/processor/agent-executor.ts` |
| Callback processor | `libs/telegram/src/processor/callback-processor.ts` |
| Session manager | `libs/telegram/src/session/session-manager.ts` |
| Command handler | `libs/telegram/src/session/command-handler.ts` |
| Webhook parser | `libs/telegram/src/webhook/parser.ts` |
| Webhook validator | `libs/telegram/src/webhook/validator.ts` |
| Router factory | `libs/telegram/src/router/factory.ts` |
| Node types | `libs/agent-studio/src/types/nodes.ts` |
| Node registry | `libs/agent-studio/src/registry/node-registry.ts` |
| Trigger executor | `libs/agent-studio/src/execution/node-executors/telegram-trigger-executor.ts` |
| Send executor | `libs/agent-studio/src/execution/node-executors/telegram-send-executor.ts` |
| Buttons executor | `libs/agent-studio/src/execution/node-executors/telegram-send-buttons-executor.ts` |
| Config forms | `apps/web-ui/components/agents/config/telegram-*-node-form.tsx` |
| Prisma schema | `prisma/schema.prisma` |

---

## Example Graphs

### Simple bot
```
[telegram_trigger] → [llm] → [telegram_send]
```

### Bot with inline buttons
```
[telegram_trigger]
        ↓
      [llm]
        ↓
[telegram_send_buttons]
  buttons: [["Yes" → "yes"], ["No" → "no"]]

(user clicks a button → callback_query fires → graph runs again)

[telegram_trigger]  (tg_callback_data = "yes" or "no")
        ↓
  [condition]
    "yes" → [telegram_send] "Great, confirmed!"
    "no"  → [telegram_send] "Okay, cancelled."
```

### Knowledge base bot
```
[telegram_trigger] → [knowledge_base] → [llm] → [telegram_send]
```

---

## What This Is NOT

- Not a generic webhook node — the webhook is infrastructure, not a canvas node
- Not a Telegram client library abstraction — grammY is used directly for API calls, not wrapped further
- Not a full Telegraf/grammY middleware stack — we own all routing and session logic
- No Telegram template equivalent — Telegram has no messaging window or pre-approval requirement

---

## Dependencies

- `grammy` — Telegram Bot API client (TypeScript, Bot API 10.0, zero transitive deps)
- No other new runtime dependencies

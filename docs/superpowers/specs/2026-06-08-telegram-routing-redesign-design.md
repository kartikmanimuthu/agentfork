# Telegram Routing Redesign — Bind Bots Directly on the Trigger Node

**Date:** 2026-06-08
**Status:** Approved for implementation
**Supersedes:** the routing-rules portion of `2026-06-07-telegram-integration-design.md`

---

## Overview

Today, connecting a Telegram bot and deciding which agent handles its messages are
two disconnected steps: `/settings/channels/telegram/connect` creates a
`TelegramAccount`, and a separate **Routing Configuration** page lets the tenant pick
a routing strategy (only `keyword` is implemented), define keyword→agent rules, and a
fallback agent. At runtime, `TelegramMessageProcessor` looks up
`TelegramRouting`/`TelegramRoutingRule`, runs `KeywordRouter`, and pins a new
conversation session to whichever `agentId` it resolves.

This redesign **fully retires** that routing-rules layer. Instead, the
`telegram_trigger` node gets a dropdown to pick which connected bot this graph
listens to (bots already bound elsewhere are hidden — strict 1:1). The binding is
written to the database automatically when the agent is saved. Any "smart dispatch"
that a tenant wants (e.g. routing by keyword) now happens *inside* the canvas using
the existing `router`/`condition`/`sub_agent` nodes — exactly like n8n/Langflow, where
the trigger node owns its one binding and all branching logic lives in the graph.

Net effect: **the canvas becomes the single source of truth** for "what happens to
this bot's messages," eliminating an entire parallel configuration surface
(`TelegramRouting`, `TelegramRoutingRule`, `KeywordRouter`, the routing settings page).

Telegram is the reference implementation; WhatsApp gets an identical mirror as a
follow-up (its routing tables/pages/router are structured identically).

---

## Goals

- One connected Telegram bot maps to **at most one** graph agent (strict 1:1)
- The binding is chosen via a dropdown on the `telegram_trigger` node — no separate
  settings page
- Already-bound bots are hidden from the dropdown on other agents (defense against
  double-processing the same webhook)
- The binding is written automatically when the agent is saved — no separate
  bind/unbind action, no drift between "what the canvas shows" and "what's bound"
- Runtime message processing becomes a single indexed lookup (`account.agentId`) —
  no routing-strategy resolution, no keyword matching, fewer DB round-trips
- Fully remove `TelegramRouting`, `TelegramRoutingRule`, `KeywordRouter`, the routing
  settings page, and their API routes — no replacement read-only page

---

## Architecture

### Before
```
Connect bot → TelegramAccount created
Separately: open Routing Configuration page → define keyword rules + fallback agent
                                            → stored in TelegramRouting/TelegramRoutingRule
Message arrives → webhook → load routing config → KeywordRouter picks an agentId → pin session
```

### After
```
Connect bot → TelegramAccount created (unbound, agentId = null)
Open a graph agent → add "Telegram Trigger" node → pick this bot from a dropdown
                     (bots already bound to other agents are hidden)
Save the agent → server scans the graph for telegram_trigger nodes with accountId set
              → upserts TelegramAccount.agentId + triggerNodeId directly
              → rejects the save if the chosen bot is already bound to a different agent
Message arrives → webhook → load account → read account.agentId directly → pin session
```

This mirrors how `TelegramSession.agentId` already works today (a plain stored
reference, resolved once at session creation, used directly) — we're applying the
same "store the resolved value, read it directly" pattern one level up, at the
account level.

---

## Data Model Changes (`prisma/schema.prisma`)

### `TelegramAccount` — add a direct FK binding

```prisma
model TelegramAccount {
  // ...existing fields...
  agentId       String?
  triggerNodeId String?

  agent Agent? @relation(fields: [agentId], references: [id], onDelete: SetNull)

  @@index([agentId])
}
```

- `agentId` — nullable real FK to `Agent`. `onDelete: SetNull` means deleting an agent
  automatically frees the bot for rebinding — no orphaned references, no extra cleanup
  code required.
- `triggerNodeId` — records *which* trigger node inside that agent's graph owns the
  binding. Used for diagnostics and to detect when a save removes/replaces that
  specific node.

A real FK (rather than the soft string references `TelegramRouting.fallbackAgentId` /
`TelegramRoutingRule.agentId` used) gives DB-enforced integrity for free and avoids
repeating a known smell.

### Removed entirely

- `TelegramRouting` model (and its `routingConfig TelegramRouting?` relation on
  `TelegramAccount`)
- `TelegramRoutingRule` model
- The `RoutingStrategy`-equivalent strategy string/enum, if nothing else references it
  (confirm via grep during implementation)

This is a destructive migration — it drops two tables and adds two columns + an FK in
one step (`bunx prisma migrate dev`). Confirmed acceptable: this is local dev with no
routing data worth preserving.

---

## Node Config + UI

### Config type (`libs/agent-studio/src/types/nodes.ts`)

```typescript
export interface TelegramTriggerNodeConfig {
  type: 'telegram_trigger';
  accountId?: string;   // NEW — which connected bot this trigger listens to
  channelMap?: { /* unchanged */ };
}
```

Plus the matching Zod schema update wherever `telegram_trigger` configs are validated
(`libs/agent-studio/src/registry/schemas/` — confirm exact file).

### UI — `telegram-trigger-node-form.tsx`

Reuses the established external-resource-dropdown pattern from
`mcp-server-node-form.tsx` + `useMcpServers`:

1. New hook `apps/web-ui/hooks/use-telegram-accounts.ts` (React Query, modeled on
   `use-mcp-servers.ts`) calling the existing `GET /api/telegram/accounts` (already
   returns tenant-scoped `{ id, botName, botUsername, status, agentId }[]`).
2. Filter the returned list client-side to:
   `account.agentId == null || account.agentId === currentAgentId`
   — i.e. show unbound bots **plus** whichever bot is already bound to *this* agent,
   so reopening the form doesn't make the current selection disappear.
3. Render a shadcn `<Select>` populated with the filtered list; selecting an option
   sets `config.accountId`, with the same loading/disabled/empty-state treatment as
   the MCP server form.

This requires `currentAgentId` to be available inside the node-config form context —
verify during implementation whether `config-panel.tsx` already threads agent context
down to node forms (likely yes, since other forms need similar tenant/agent scoping).

---

## Backend: Sync the Binding on Save

A small function — e.g. `syncTelegramAccountBinding(tenantId, agentId, config)` in
`libs/shared/src/services/` — called from the agent save route
(`apps/web-ui/app/api/agents/[id]/route.ts` PATCH/PUT — confirm exact path), run
**inside the same transaction** as the agent/version save:

```
1. Walk config.nodes, find telegram_trigger nodes with accountId set.
   - If more than one is found, reject the save with a clear validation
     error ("Only one Telegram Trigger can be bound per agent").
2. If exactly one is found:
     - load the TelegramAccount, verify tenantId matches (authz boundary)
     - if it's bound to a DIFFERENT agentId → reject the save
       ("This bot is already connected to <agent name>")
     - else upsert agentId = this agent, triggerNodeId = nodeId
3. Clear agentId/triggerNodeId on any TelegramAccount previously bound to this
   agent that the new config no longer references (handles "removed the trigger
   node" and "picked a different bot").
```

Wrapped in try/catch with Pino logging (`{ tenantId, agentId, accountId }`) per the
project's mandatory error-handling/logging standards. Running inside the save
transaction guarantees the binding state never drifts from the saved graph — the
moment Save is clicked, the binding either commits cleanly or the whole save is
rejected with a clear, actionable reason.

---

## Runtime Simplification

### `libs/telegram/src/processor/message-processor.ts`

Replace the routing-table lookup + `createRouter`/`KeywordRouter` invocation with a
direct read of the stored binding:

```typescript
let session = await this.deps.sessionManager.findActiveSession(account.id, chatId);

if (!session) {
  if (!account.agentId) {
    logger.warn({ accountId: account.id }, 'No agent bound to Telegram account — dropping message');
    return;
  }
  session = await this.deps.sessionManager.createSession({
    tenantId: account.tenantId,
    accountId: account.id,
    chatId,
    contactName: fromName,
    agentId: account.agentId,
  });
}
```

This removes the `telegramRouting`/`telegramRoutingRule` Prisma queries and the
`createRouter` call from the hot path entirely — fewer DB round-trips on every first
message, and simpler code to reason about.

---

## Cleanup — Delete Now-Dead Code

- `libs/telegram/src/router/` — `factory.ts`, `keyword-router.ts`, `router.interface.ts`
  (and any tests) — nothing calls `createRouter` once message-processor stops using it
- `apps/web-ui/app/(dashboard)/settings/channels/telegram/[id]/routing/page.tsx` —
  deleted outright (no read-only replacement — confirmed with the user)
- `apps/web-ui/app/api/telegram/accounts/[id]/routing/route.ts` and
  `apps/web-ui/app/api/telegram/routing/route.ts` — deleted
- The "Routing" link/gear icon pointing at the old settings page, removed from the
  channels list UI

---

## Edge Cases & Guardrails

- **Active sessions are sticky**: `TelegramSession.agentId` is captured at session
  creation and never changes. Rebinding an account to a different agent does not
  affect conversations already in progress — only new sessions pick up the new
  binding. This matches today's behavior (routing-rule changes also didn't
  retroactively re-route active sessions); no change needed.
- **Double-bind race**: the dropdown hides already-bound accounts client-side, and the
  save-time sync rejects binding to an account owned by a different agent
  server-side — defense in depth against two browser tabs racing to bind the same bot.
- **Disconnecting a bot** (`/api/telegram/disconnect`): if disconnect deletes the
  `TelegramAccount` row, `onDelete: SetNull` clears the FK automatically; if it only
  flips `status` to `inactive`, the disconnect handler must explicitly clear
  `agentId`/`triggerNodeId` so the bot becomes bindable again after reconnecting.
- **Multiple `telegram_trigger` nodes in one graph**: rejected at save time (see
  Backend Sync step 1) with a clear validation error — keeps the 1:1 invariant
  airtight rather than silently picking "the first one," which the executor does
  today for entry-node selection.

---

## WhatsApp Mirror (Follow-up)

Telegram ships first as the reference implementation (smaller blast radius, validates
the pattern end-to-end). WhatsApp then gets an identical mirror:

- Same schema shape: `WhatsAppAccount.agentId` / `triggerNodeId`
- Same node-form dropdown: `whatsapp-trigger-node-form.tsx` + new `useWhatsAppAccounts`
  hook
- Same `syncTelegramAccountBinding`-equivalent sync call (or a shared
  channel-parameterized version), wired into the same agent-save transaction
- Same message-processor simplification in `libs/whatsapp/src/processor/message-processor.ts`
- Same cleanup of `WhatsAppRouting`, `WhatsAppRoutingRule`, WhatsApp's router code, and
  its routing settings page/routes

---

## Verification Plan

1. **Type-check / unit tests**: `nx test agent-studio`, `nx test telegram`,
   `bunx tsc --noEmit` (or the project's standard typecheck) after schema/type changes
2. **Manual end-to-end** (start the dev server, exercise the real flow per CLAUDE.md
   UI-testing guidance):
   - Connect a fresh Telegram bot, open a graph agent, add a Telegram Trigger node,
     confirm the new bot appears in the dropdown
   - Bind it, save, confirm `TelegramAccount.agentId` is set (Prisma Studio or a quick
     query) and the bot disappears from other agents' dropdowns
   - Send a message to the bot via a real Telegram chat — confirm it routes to the
     bound agent with no routing-config page in existence
   - Try to bind the same account from a second agent — confirm it's hidden in the
     picker and/or rejected on save with a clear error
   - Disconnect the bot — confirm the binding clears and the account becomes bindable
     again
   - Add a second `telegram_trigger` node with an `accountId` set in the same graph —
     confirm the save is rejected with the "only one trigger can be bound" error
3. Update or remove any e2e specs that reference the old routing settings page
   (relevant module tag — confirm during implementation)
4. Repeat the bind/send/rebind/double-bind checks for WhatsApp once mirrored

---

## Files To Touch (confirm exact paths during implementation)

- `prisma/schema.prisma` (+ generated migration)
- `libs/agent-studio/src/types/nodes.ts` and the `telegram_trigger` Zod schema
- `apps/web-ui/components/agents/config/telegram-trigger-node-form.tsx`
- `apps/web-ui/hooks/use-telegram-accounts.ts` (new, modeled on `use-mcp-servers.ts`)
- `libs/shared/src/services/` — new `syncTelegramAccountBinding` function
- `apps/web-ui/app/api/agents/[id]/route.ts` — call the sync function on save
- `libs/telegram/src/processor/message-processor.ts` — direct `account.agentId` read
- Delete: `libs/telegram/src/router/*`, the routing settings page, and the
  `/api/telegram/.../routing` + `/api/telegram/routing` API routes
- Channels list page — remove the "Routing" link to the deleted settings page

(WhatsApp mirror touches the equivalent files under `libs/whatsapp` and
`whatsapp-trigger-node-form.tsx` — tracked as a follow-up, not part of this spec's
implementation scope.)

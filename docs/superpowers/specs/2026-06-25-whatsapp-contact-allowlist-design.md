# WhatsApp Contact Allowlist — Design Spec

**Date:** 2026-06-25
**Status:** Approved
**Branch:** automation-test-suites

## Overview

While verifying the Netcore WhatsApp integration, real inbound messages from real, unknown phone numbers were observed being answered automatically by the LLM agent (via a temporary ngrok tunnel pointed at a local dev server). The replies included fabricated, business-specific content (e.g. an invented "Punjab National Bank, Jaora" customer-service persona) that had no relation to the connected account. The tunnel has since been stopped, but the underlying gap remains: any number that messages a connected WhatsApp account gets a fully automated, unreviewed LLM reply, with no way to restrict this to known/approved numbers during testing or staged rollout.

This spec adds a per-account allowlist: when enabled, only listed numbers get auto-replies. Everyone else's messages are still received and stored (so there's a record of who messaged), but no command handling, routing, agent execution, or reply happens for them.

## Data Model

Two additions, no changes to existing fields:

```prisma
model WhatsAppAccount {
  // ...existing fields...
  restrictToAllowlist Boolean @default(true)

  allowedContacts WhatsAppAllowedContact[]
}

model WhatsAppAllowedContact {
  id          String   @id @default(cuid())
  accountId   String
  phoneNumber String
  label       String?
  createdAt   DateTime @default(now())

  account WhatsAppAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, phoneNumber])
  @@index([accountId])
  @@map("whatsapp_allowed_contacts")
}
```

`restrictToAllowlist` defaults to `true`. This is deliberate: the migration applies this default to every existing row, so the already-connected Netcore account becomes restricted the moment this ships, with zero numbers allowed until someone adds them. That's the intended fix for the issue that motivated this spec — not a side effect to work around.

`phoneNumber` stores digits-only with country code (matching the format already used for `WhatsAppAccount.phoneNumberId` and seen in every real captured payload, e.g. `918826603017`) — no `+`, no spaces. `label` is optional free text for the operator's own reference; it has no effect on matching or behavior.

## Enforcement Point

`libs/whatsapp/src/processor/message-processor.ts`, inside `processMessageEvent`. The existing flow today is:

```
look up account by phoneNumberId
  → dedup check (existing waMessageId)
  → acquire contact lock
    → circuit breaker check
    → store inbound WhatsAppMessage
    → [NEW CHECK GOES HERE]
    → check for commands (/reset, /switch, /help)
    → find-or-create session / routing
    → execute agent, send reply
  → release contact lock
```

Immediately after the inbound `WhatsAppMessage.create(...)` call: if `account.restrictToAllowlist` is true, query `WhatsAppAllowedContact` for `(accountId, phoneNumber: contact.wa_id)`. If no match, release the contact lock and return — nothing past this point executes. If `restrictToAllowlist` is false, behave exactly as today (no query, no behavior change).

This is the only change to `MessageProcessor`. It sits inside the existing lock's `try` block, so the `finally` block's lock release already covers the early return — no new lock-handling code needed. It applies identically to Meta and Netcore accounts since it's in the shared core, not provider-specific code.

## API

New routes, mirroring the existing `/api/whatsapp/accounts/[id]/routing` pattern exactly (same auth check — `authorize('read'|'update', 'TenantConfig', authOptions)` — same account-scoping via `tenantId`, same Zod-at-the-boundary, same error handling):

- `GET /api/whatsapp/accounts/[id]/allowlist` → `{ restrictToAllowlist: boolean, contacts: Array<{ id, phoneNumber, label, createdAt }> }`
- `PUT /api/whatsapp/accounts/[id]/allowlist` → body `{ restrictToAllowlist: boolean }`, updates the account's flag only
- `POST /api/whatsapp/accounts/[id]/allowlist/contacts` → body `{ phoneNumber: string (regex /^\d{10,15}$/), label?: string }`, creates one entry; `409` if the `(accountId, phoneNumber)` unique constraint is violated
- `DELETE /api/whatsapp/accounts/[id]/allowlist/contacts/[contactId]` → removes one entry

## UI

New sub-page `apps/web-ui/app/(dashboard)/settings/channels/whatsapp/[id]/allowlist/page.tsx`, reached via a third icon button (alongside the existing Routing/Templates icons) on the accounts table in `.../whatsapp/page.tsx`. Layout, mirroring the Routing page's structure:

- A `Switch` at the top bound to `restrictToAllowlist`, with a one-line caption explaining what it does ("When on, only numbers listed below receive automated replies. Everyone else's messages are still received but get no response.")
- Below it, a simple list (phone number, label, remove button) with an "Add number" row (two inputs — phone number, optional label — plus an add button), using the same shadcn `Input`/`Button`/`Label` components and Zod validation pattern as the Netcore connect form.

## Out of Scope

- This gates **auto-replies triggered by an inbound message** only (the path through `processMessageEvent`). It does not touch manually-triggered sends — the Settings UI's "send a template manually" feature and any graph that sends a WhatsApp message from a non-WhatsApp-triggered flow are unaffected. If those need the same restriction later, that's a separate decision, not assumed here.
- No bulk import of numbers (add one at a time — matches the expected scale of a test allowlist).
- No distinction between "blocked" and "not yet allowed" — this is a strict allowlist, not an allow/block list with separate semantics.
- No retroactive effect on already-active `WhatsAppSession` rows for now-disallowed contacts — if a number had a session before being removed from (or never added to) the allowlist, the early-return happens before session lookup, so an existing session simply stops progressing. Not cleaning up stale sessions is consistent with how sessions already expire naturally (24h window) elsewhere in this codebase.

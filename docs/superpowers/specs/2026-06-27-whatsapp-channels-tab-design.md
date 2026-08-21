# WhatsApp Channels Tab for Simple Agents — Design Spec

**Goal:** Let users connect a WhatsApp account directly to a simple agent from the agent's edit page, so the agent replies to WhatsApp messages with full KB, MCP, and built-in tool support — the same capability it has in the playground.

**Architecture:** Add `agentId` to `WhatsAppAccount` (one-to-one, mirrors `TelegramAccount`). Add a Channels tab to the simple agent edit page. When a message arrives on a connected account, the processor short-circuits the routing system and runs the agent directly. Fix `executeSimpleAgent` to query KB and load MCP/built-in tools before calling the LLM.

**Tech Stack:** Prisma (schema + migration), Next.js API routes, React + TanStack Query, shadcn/ui, `@chatbot/agent-studio/server` (`buildMcpToolsForAgent`), `@chatbot/ai` (`streamChat`, `buildBuiltInTools`).

---

## Global Constraints

- Simple agents only — graph agents are excluded from the Channels tab entirely.
- One WhatsApp account connects to at most one agent at a time. Connecting an account that is already taken clears the previous agent's connection first.
- The existing `WhatsAppRouting` system must not be modified. Accounts without `agentId` continue through the routing path unchanged.
- The `executeSimpleAgent` fix applies to all simple agent WhatsApp invocations (not just Channels-connected ones). It is purely additive — no existing behaviour changes, only new capability is added.
- All new API routes must validate input with Zod, use Pino logging with structured context, and wrap logic in try/catch.
- All new UI must use shadcn/ui components only.
- No new env vars required.

---

## Section 1: Schema

**File:** `prisma/schema.prisma`
**Migration:** `prisma/migrations/20260627000000_add_whatsapp_account_agent_id/migration.sql`

Add to `WhatsAppAccount`:

```prisma
agentId  String?
agent    Agent?  @relation("WhatsAppAccountAgent", fields: [agentId], references: [id], onDelete: SetNull)
```

Add back-relation to `Agent` model:

```prisma
whatsAppAccounts  WhatsAppAccount[]  @relation("WhatsAppAccountAgent")
```

Add index to `WhatsAppAccount`:

```prisma
@@index([agentId])
```

`onDelete: SetNull` — deleting the agent automatically clears the connection.

---

## Section 2: Execution Path

**File:** `libs/whatsapp/src/processor/message-processor.ts`

In `processMessageEvent`, after the session lookup (`let session = await ...`), add a new branch before the existing routing block:

```ts
if (!session) {
  // NEW: Channels-tab connection — skip routing system entirely
  if (account.agentId) {
    session = await this.deps.sessionManager.createSession({
      accountId: account.id,
      contactPhone: contact.wa_id,
      contactName: contact.profile.name,
      agentId: account.agentId,
    });
  } else {
    // EXISTING: routing path — completely unchanged
    const routing = await (this.deps.prisma as any).whatsAppRouting.findUnique({
      where: { accountId: account.id },
    });
    if (!routing) return;
    // ... rest of existing routing logic unchanged
  }
}
```

Nothing else in the processor changes.

---

## Section 3: executeSimpleAgent Fix (KB + MCP parity)

**File:** `libs/whatsapp/src/processor/agent-executor.ts`

`executeSimpleAgent` currently does a plain `provider.chat()` call with no tools or KB. Fix it to match playground behaviour:

1. **Resolve LLM provider** — call `resolveTenantLLMConfig(tenantId, model)` (extracted from `factory.ts` into a shared helper or inlined) then `createLLMProvider(llmConfig)`.

2. **Query KB** — for each `AgentKnowledgeBase` attached to this agent, call `RetrievalService.query(userMessage, { knowledgeBaseId, topK: 5 })`. Concatenate results and append to the system prompt:
   ```
   \n\nUse the following retrieved context to answer questions. If the context does not contain the answer, say so.\n\n{kbContext}
   ```
   Skip KBs with status not `active`. Swallow per-KB retrieval errors (same as playground).

3. **Load MCP + built-in tools** — call `buildMcpToolsForAgent(agentId, tenantId, prisma)` and `buildBuiltInTools(tenantId, ...)`. Merge into `allTools`.

4. **Call LLM** — use `streamChat` with `tools: allTools, maxSteps: 5` when tools exist, no tools when empty. Collect full text via `await result.text`. Call `mcpCleanup()` after.

The `LlmProviderFactory` type and the `factory.ts` provider closure remain as-is. `executeSimpleAgent` resolves the provider directly instead of going through the factory wrapper — the factory wrapper is only needed for the old `chat()` interface which is no longer called.

`executeGraphAgent` — untouched.

---

## Section 4: API Routes

### New: `GET /api/agents/[id]/channels/whatsapp`

Returns the WhatsApp account currently connected to this agent, or `null`.

```ts
// Response
{ account: { id, displayName, displayPhone, provider } | null }
```

### New: `POST /api/agents/[id]/channels/whatsapp`

Connects a WhatsApp account to this agent. Enforces one-to-one: first clears `agentId` from any account currently pointing to this agent, then sets `agentId` on the target account.

```ts
// Request body (Zod-validated)
{ accountId: z.string().min(1) }

// Response
{ account: { id, displayName, displayPhone, provider } }
```

Returns 404 if the account doesn't exist or belongs to a different tenant.

### New: `DELETE /api/agents/[id]/channels/whatsapp`

Clears `agentId` on the connected account (sets to null). No-op if nothing is connected.

```ts
// Response
{ ok: true }
```

### Existing: `GET /api/whatsapp/accounts`

Add `agentId` to the `select` block so the UI knows which accounts are already taken:

```ts
select: {
  id: true,
  agentId: true,   // ← add this
  provider: true,
  ...
}
```

No other changes to this route.

---

## Section 5: UI

### New: `apps/web-ui/hooks/use-whatsapp-accounts.ts`

Same pattern as `useTelegramAccounts`. Fetches `GET /api/whatsapp/accounts`, returns accounts with `agentId` included.

```ts
export interface WhatsAppAccountSummary {
  id: string;
  agentId: string | null;
  provider: string;
  displayPhone: string;
  displayName: string;
  status: string;
}
```

### New: `apps/web-ui/hooks/use-agent-whatsapp-channel.ts`

TanStack Query hook for the agent's connected channel. Provides:
- `useAgentWhatsAppChannel(agentId)` — GET
- `useConnectWhatsAppChannel(agentId)` — mutation for POST
- `useDisconnectWhatsAppChannel(agentId)` — mutation for DELETE

### New: `apps/web-ui/components/agents/tabs/channels-tab.tsx`

Props: `{ agentId: string }`

**Not connected:**
```
[Card]
  WhatsApp
  Connect a WhatsApp account so this agent replies to messages on that number.

  [Select dropdown — accounts not taken by another agent]   [Connect button]

  "Accounts already connected to another agent are hidden."
```

**Connected:**
```
[Card]
  WhatsApp
  [CheckCircle icon]  DisplayName  •  +91 xxxx  •  [provider badge]   [Disconnect button]
```

Disconnect shows an `AlertDialog` confirmation before clearing. Uses `toast.success` / `toast.error` for feedback.

### Modified: `apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx`

Simple agent section only — add the Channels tab between Tools and Versions:

```tsx
<TabsTrigger value="channels">Channels</TabsTrigger>
...
<TabsContent value="channels">
  <ChannelsTab agentId={agentId} />
</TabsContent>
```

Graph agent section — no change.

---

## What Is Not Touched

- `WhatsAppRouting`, routing rules, routing API routes — unchanged
- `executeGraphAgent` — unchanged
- Graph agent edit page — unchanged
- All Telegram code — unchanged
- All existing WhatsApp API routes except the one-field addition to accounts GET
- Allowlist logic — unchanged
- `message-processor.ts` routing branch — wrapped in an `else`, completely unchanged

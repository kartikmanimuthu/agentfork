# WhatsApp Graph Nodes Implementation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three graph node types — `whatsapp_trigger`, `whatsapp_send`, and `whatsapp_send_template` — so that WhatsApp conversations can drive and be driven by graph agents end-to-end.

**Architecture:** The existing webhook handler (`/api/webhooks/whatsapp/route.ts`) receives and validates inbound messages. It delegates to `MessageProcessor`, which resolves the routing rule and calls `WhatsAppAgentExecutor`. That executor's `executeGraphAgent` method is currently a stub — this design replaces it with the real `GraphExecutor`. The three new node types handle channel I/O within the graph. The `MetaWhatsAppClient` (already in `libs/whatsapp`) handles all Meta API calls.

**Tech Stack:** TypeScript strict, Zod v4, Prisma 6, `libs/agent-studio` GraphExecutor, `libs/whatsapp` MetaWhatsAppClient, Next.js 15 API routes.

---

## End-to-End Data Flow

```
Customer sends WhatsApp message
        |
        v
Meta Cloud API → POST /api/webhooks/whatsapp/route.ts
  - HMAC signature verified
  - Payload parsed → WhatsAppEvent[]
  - Dispatched to MessageProcessor (background, returns 200 immediately)
        |
        v
MessageProcessor.processMessageEvent()
  - Acquires contact lock (prevents concurrent processing for same sender)
  - Resolves WhatsAppRouting → finds agentId
  - Manages WhatsAppSession (upsert, 24h window tracking)
  - Calls WhatsAppAgentExecutor.execute(agentId, message, context)
        |
        v
WhatsAppAgentExecutor.executeGraphAgent()   ← THIS IS REPLACED
  - Builds initial GraphState with WhatsApp channels:
      wa_sender_id, wa_message_text, wa_message_type,
      wa_media_id, wa_phone_number_id, wa_account_id,
      wa_session_id, wa_within_window
  - Instantiates GraphExecutor, registers all node executors
  - Calls graphExecutor.execute(graphDef, initialState, options)
        |
        v
GraphExecutor runs nodes in sequence:

  [whatsapp_trigger] → reads initial state → writes WA channels
          |
          v
  [llm / condition / router / ...] ← your graph logic
          |
          v
  [whatsapp_send] or [whatsapp_send_template]
    - reads wa_sender_id + wa_phone_number_id from channels
    - looks up WhatsAppAccount in DB by phone_number_id
    - decrypts access token
    - calls MetaWhatsAppClient.sendTextMessage() or sendTemplateMessage()
        |
        v
Customer receives reply on WhatsApp
```

---

## State Channels Contract

The following channels are populated by the webhook layer before the graph starts, and are available to all nodes including `whatsapp_trigger`:

| Channel | Type | Description |
|---|---|---|
| `wa_sender_id` | `string` | Customer's WhatsApp phone number (wa_id) |
| `wa_message_text` | `string` | Text body (empty string if media message) |
| `wa_message_type` | `string` | `text \| image \| audio \| video \| document \| sticker \| location \| interactive \| reaction` |
| `wa_media_id` | `string \| null` | Meta media ID (only for media messages) |
| `wa_phone_number_id` | `string` | Your WhatsApp phone number ID (Meta) — used by Send nodes to look up account credentials |
| `wa_account_id` | `string` | Your WhatsApp account DB ID (Prisma WhatsAppAccount.id) |
| `wa_session_id` | `string` | WhatsApp session DB ID for conversation continuity |
| `wa_within_window` | `boolean` | Whether current time is within 24h of last inbound message (Customer Service Window) |

---

## Node 1: WhatsApp Trigger (`whatsapp_trigger`)

### Purpose
Entry point for WhatsApp-driven graphs. Reads the pre-populated WA channels from state and optionally remaps them to custom channel names for downstream nodes.

### Config Interface
```typescript
export interface WhatsAppTriggerNodeConfig {
  type: 'whatsapp_trigger';
  // Optional remapping: downstream channel name → WA channel name
  // If omitted, WA channels are available directly (wa_sender_id, etc.)
  channelMap?: {
    senderIdChannel?: string;      // default: 'wa_sender_id'
    messageTextChannel?: string;   // default: 'wa_message_text'
    messageTypeChannel?: string;   // default: 'wa_message_type'
    mediaIdChannel?: string;       // default: 'wa_media_id'
    withinWindowChannel?: string;  // default: 'wa_within_window'
  };
}
```

### Executor Behaviour
1. Reads all `wa_*` values from `ctx.state.channels`
2. Validates required fields are present (`wa_sender_id`, `wa_phone_number_id`) — throws if missing (means graph was started outside of WhatsApp context)
3. If `channelMap` is configured, copies values to the mapped channel names in addition to the default names
4. Returns `stateUpdates` with all values confirmed/remapped
5. `next: null` (GraphExecutor follows edges as normal)

### Default Config (for Node Registry)
```typescript
{
  type: 'whatsapp_trigger',
}
```

### Zod Schema
```typescript
export const whatsappTriggerNodeSchema = z.object({
  type: z.literal('whatsapp_trigger'),
  channelMap: z.object({
    senderIdChannel: z.string().optional(),
    messageTextChannel: z.string().optional(),
    messageTypeChannel: z.string().optional(),
    mediaIdChannel: z.string().optional(),
    withinWindowChannel: z.string().optional(),
  }).optional(),
});
```

---

## Node 2: WhatsApp Send (`whatsapp_send`)

### Purpose
Sends a freeform reply to the customer. Only valid within the 24-hour Customer Service Window. Reads the reply text (or media ID) from a configurable channel. Reads recipient and account from the `wa_*` channels automatically.

### Config Interface
```typescript
export interface WhatsAppSendNodeConfig {
  type: 'whatsapp_send';
  messageType: 'text' | 'image' | 'document' | 'audio' | 'video';
  // Channel whose value is the message body (text) or caption (media)
  messageChannel: string;
  // Channel whose value is the media ID — required for non-text messageType
  mediaIdChannel?: string;
  // Filename for document messages
  filenameChannel?: string;
}
```

### Executor Behaviour
1. Reads `wa_sender_id` and `wa_phone_number_id` from `ctx.state.channels` — throws if missing
2. Reads `wa_account_id` from channels — uses it to load `WhatsAppAccount` from DB via `ctx.services.prisma`
3. Decrypts `accessToken` using `EncryptionService`
4. Instantiates `MetaWhatsAppClient` with `{ accessToken, phoneNumberId: wa_phone_number_id, apiVersion: 'v22.0' }`
5. Reads message content from `config.messageChannel`
6. Calls the appropriate `MetaWhatsAppClient` method based on `config.messageType`
7. Returns `stateUpdates: { wa_last_sent_message_id: response.messages[0].id }`
8. On Meta API error: logs error, throws (GraphExecutor marks node as failed)

### Default Config
```typescript
{
  type: 'whatsapp_send',
  messageType: 'text',
  messageChannel: 'llm_output',
}
```

### Zod Schema
```typescript
export const whatsappSendNodeSchema = z.object({
  type: z.literal('whatsapp_send'),
  messageType: z.enum(['text', 'image', 'document', 'audio', 'video']),
  messageChannel: z.string().min(1),
  mediaIdChannel: z.string().optional(),
  filenameChannel: z.string().optional(),
});
```

---

## Node 3: WhatsApp Send Template (`whatsapp_send_template`)

### Purpose
Sends a pre-approved Meta template message. Works outside the 24-hour window. Used to initiate or re-engage conversations. Template parameters are read from a channel as a JSON array.

### Config Interface
```typescript
export interface WhatsAppSendTemplateNodeConfig {
  type: 'whatsapp_send_template';
  templateName: string;
  languageCode: string;   // e.g. 'en_US', 'en', 'hi'
  // Channel whose value is an array of template component objects (JSON)
  // If omitted, sends template with no variable parameters
  componentsChannel?: string;
}
```

### Executor Behaviour
1. Reads `wa_sender_id` and `wa_phone_number_id` from channels — throws if missing
2. Loads `WhatsAppAccount` from DB, decrypts token, instantiates `MetaWhatsAppClient`
3. Reads components from `config.componentsChannel` if set (parses string as JSON if needed)
4. Calls `MetaWhatsAppClient.sendTemplateMessage(wa_sender_id, { name, language: { code }, components })`
5. Returns `stateUpdates: { wa_last_sent_message_id: response.messages[0].id }`
6. On Meta API error: logs error, throws

### Default Config
```typescript
{
  type: 'whatsapp_send_template',
  templateName: '',
  languageCode: 'en',
}
```

### Zod Schema
```typescript
export const whatsappSendTemplateNodeSchema = z.object({
  type: z.literal('whatsapp_send_template'),
  templateName: z.string().min(1),
  languageCode: z.string().min(2),
  componentsChannel: z.string().optional(),
});
```

---

## Changes to Existing Files

### 1. `libs/agent-studio/src/types/nodes.ts`
- Add `'whatsapp_trigger' | 'whatsapp_send' | 'whatsapp_send_template'` to `NodeType` union
- Add `WhatsAppTriggerNodeConfig`, `WhatsAppSendNodeConfig`, `WhatsAppSendTemplateNodeConfig` interfaces
- Add them to the `NodeConfig` discriminated union

### 2. `libs/agent-studio/src/registry/schemas/` (3 new files)
- `whatsapp-trigger.ts` — exports `whatsappTriggerNodeSchema`
- `whatsapp-send.ts` — exports `whatsappSendNodeSchema`
- `whatsapp-send-template.ts` — exports `whatsappSendTemplateNodeSchema`

### 3. `libs/agent-studio/src/registry/node-registry.ts`
- Import the 3 new schemas
- Add them to the `nodeConfigSchema` discriminated union
- Add 3 new `NodeDefinition` entries to the `definitions` array

### 4. `libs/agent-studio/src/execution/node-executors/` (3 new files)
- `whatsapp-trigger-executor.ts`
- `whatsapp-send-executor.ts`
- `whatsapp-send-template-executor.ts`

### 5. `libs/agent-studio/src/execution/node-executors/index.ts`
- Export the 3 new executors

### 6. `libs/agent-studio/src/server.ts`
- Add the 3 new executors to `createNodeExecutors()` return array

### 7. `libs/whatsapp/src/processor/agent-executor.ts`
- Replace stub `executeGraphAgent()` with real implementation using `GraphExecutor` + `createNodeExecutors()`
- Build initial `GraphState` from incoming message + session context
- Compute `wa_within_window` from `WhatsAppSession.lastMessageAt`

### 8. `libs/agent-studio/src/execution/types.ts`
- Add `EncryptionService` to `ExecutionServices` interface so Send nodes can decrypt tokens

---

## ExecutionServices Extension

```typescript
export interface ExecutionServices {
  llmProvider: (providerId?: string, modelId?: string) => Promise<any>;
  prisma: any;
  encryptionService?: EncryptionService;  // added — used by WhatsApp Send nodes
}
```

The `WhatsAppAgentExecutor` passes `encryptionService` when calling `GraphExecutor`. Existing node executors ignore it (optional field).

---

## WhatsAppAgentExecutor.executeGraphAgent() — New Implementation

```typescript
private async executeGraphAgent(
  agent: { id: string; config: any },
  message: { text?: string; mediaUrl?: string; mediaType?: string; mediaId?: string },
  context: Record<string, unknown>,
): Promise<{ text: string }> {
  const { GraphExecutor, createNodeExecutors } = await import('@chatbot/agent-studio/server');

  const graphDef = agent.config as { nodes: any[]; edges: any[] };

  // Build initial state — all wa_* channels pre-populated
  const initialState: GraphState = {
    channels: {
      wa_sender_id: context.wa_sender_id as string,
      wa_message_text: message.text ?? '',
      wa_message_type: context.wa_message_type as string ?? 'text',
      wa_media_id: context.wa_media_id ?? null,
      wa_phone_number_id: context.wa_phone_number_id as string,
      wa_account_id: context.wa_account_id as string,
      wa_session_id: context.wa_session_id as string,
      wa_within_window: context.wa_within_window as boolean,
      // Conversation history from session
      messages: (context.messages as any[]) ?? [],
    },
    messages: (context.messages as any[]) ?? [],
    currentNodeId: null,
    metadata: {
      executionId: crypto.randomUUID(),
      agentId: agent.id,
      tenantId: context.tenantId as string,
      userId: 'whatsapp',
      startedAt: new Date(),
    },
  };

  const encryptionService = new EncryptionService();
  const executor = new GraphExecutor({
    llmProvider: this.providerFactory as any,
    prisma: this.prisma,
    encryptionService,
  });

  for (const nodeExecutor of createNodeExecutors()) {
    executor.register(nodeExecutor);
  }

  let finalText = '';

  await executor.execute(graphDef, initialState, {
    onEvent: (event) => {
      if (event.type === 'node_complete' && event.trace.output?.response) {
        finalText = String(event.trace.output.response);
      }
      if (event.type === 'execution_complete') {
        const response = event.finalState.channels['response']
          ?? event.finalState.channels['llm_output']
          ?? '';
        finalText = String(response);
      }
    },
  });

  return { text: finalText };
}
```

---

## Context Fields Required from MessageProcessor

`WhatsAppAgentExecutor.execute()` already receives `context: Record<string, unknown>`. The `MessageProcessor` must populate these additional fields before calling the executor:

| Field | Source |
|---|---|
| `wa_sender_id` | `event.message.from` (wa_id) |
| `wa_message_type` | `event.message.type` |
| `wa_media_id` | `event.message.image?.id \| event.message.video?.id \| ...` |
| `wa_phone_number_id` | `event.metadata.phoneNumberId` |
| `wa_account_id` | `WhatsAppAccount.id` (already resolved during routing) |
| `wa_session_id` | `WhatsAppSession.id` (already resolved during session management) |
| `wa_within_window` | `Date.now() - session.lastMessageAt.getTime() < 24 * 60 * 60 * 1000` |
| `tenantId` | Resolved from `WhatsAppAccount.tenantId` |

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `wa_sender_id` missing in Send node | Throw with descriptive message — graph marked failed |
| `WhatsAppAccount` not found in DB | Throw — graph marked failed |
| Meta API rejects message (e.g. outside 24h window, wrong template) | Log `logger.error`, throw — graph marked failed, MessageProcessor logs but does NOT retry |
| Graph execution throws | `WhatsAppAgentExecutor` catches, returns `{ text: '' }`, MessageProcessor logs error |
| Template not found / rejected by Meta | Meta returns 400 — caught in Send Template executor, thrown |

---

## Testing Approach

### Unit tests (Vitest)
- `whatsapp-trigger-executor.test.ts` — verify channel remapping, missing field validation
- `whatsapp-send-executor.test.ts` — mock `MetaWhatsAppClient`, verify correct method called per `messageType`, verify account lookup
- `whatsapp-send-template-executor.test.ts` — mock `MetaWhatsAppClient.sendTemplateMessage`, verify components parsing

### Integration test
- `agent-executor.test.ts` — extend existing test with a graph agent config containing `whatsapp_trigger → llm → whatsapp_send`; mock GraphExecutor; verify `executeGraphAgent` builds correct initial state

### Manual test flow
1. Configure a graph agent with: `[whatsapp_trigger] → [llm] → [whatsapp_send]`
2. Assign this agent to a WhatsApp routing rule
3. Send a WhatsApp message to the connected number
4. Verify the reply arrives

---

## Files Created / Modified Summary

| File | Action |
|---|---|
| `libs/agent-studio/src/types/nodes.ts` | Modify — add 3 types + 3 config interfaces |
| `libs/agent-studio/src/registry/schemas/whatsapp-trigger.ts` | Create |
| `libs/agent-studio/src/registry/schemas/whatsapp-send.ts` | Create |
| `libs/agent-studio/src/registry/schemas/whatsapp-send-template.ts` | Create |
| `libs/agent-studio/src/registry/node-registry.ts` | Modify — add 3 definitions |
| `libs/agent-studio/src/execution/node-executors/whatsapp-trigger-executor.ts` | Create |
| `libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.ts` | Create |
| `libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.ts` | Create |
| `libs/agent-studio/src/execution/node-executors/index.ts` | Modify — export 3 new executors |
| `libs/agent-studio/src/execution/types.ts` | Modify — add `encryptionService` to `ExecutionServices` |
| `libs/agent-studio/src/server.ts` | Modify — register 3 new executors in `createNodeExecutors()` |
| `libs/whatsapp/src/processor/agent-executor.ts` | Modify — replace stub with real GraphExecutor call |
| `libs/whatsapp/src/processor/message-processor.ts` | Modify — populate new context fields before calling executor |

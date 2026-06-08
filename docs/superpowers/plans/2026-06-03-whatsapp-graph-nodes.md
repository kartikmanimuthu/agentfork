# WhatsApp Graph Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `whatsapp_trigger`, `whatsapp_send`, and `whatsapp_send_template` graph node types so incoming WhatsApp messages can drive graph agent execution end-to-end.

**Architecture:** Three new node executors follow the existing `NodeExecutor` interface in `libs/agent-studio`. The existing `WhatsAppAgentExecutor.executeGraphAgent()` stub is replaced with a real `GraphExecutor.executeFromState()` call that pre-populates `wa_*` channels. `MessageProcessor` enriches the context object before calling the executor and conditionally skips its own send when the graph already handled it.

**Tech Stack:** TypeScript strict, Zod v4, Vitest, `libs/agent-studio` GraphExecutor, `libs/whatsapp` MetaWhatsAppClient, EncryptionService from `@chatbot/shared`.

---

## File Map

| File | Action |
|---|---|
| `libs/agent-studio/src/types/nodes.ts` | Modify — add 3 config interfaces + extend unions |
| `libs/agent-studio/src/registry/schemas/whatsapp-trigger.ts` | Create |
| `libs/agent-studio/src/registry/schemas/whatsapp-send.ts` | Create |
| `libs/agent-studio/src/registry/schemas/whatsapp-send-template.ts` | Create |
| `libs/agent-studio/src/registry/node-registry.ts` | Modify — import schemas, add 3 definitions |
| `libs/agent-studio/src/execution/node-executors/whatsapp-trigger-executor.ts` | Create |
| `libs/agent-studio/src/execution/node-executors/whatsapp-trigger-executor.test.ts` | Create |
| `libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.ts` | Create |
| `libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.test.ts` | Create |
| `libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.ts` | Create |
| `libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.test.ts` | Create |
| `libs/agent-studio/src/execution/node-executors/index.ts` | Modify — export 3 new executors |
| `libs/agent-studio/src/server.ts` | Modify — register 3 new executors in `createNodeExecutors()` |
| `libs/whatsapp/src/processor/message-processor.ts` | Modify — enrich context, conditional send |
| `libs/whatsapp/src/processor/agent-executor.ts` | Modify — replace stub with real GraphExecutor call |
| `libs/whatsapp/src/processor/agent-executor.test.ts` | Modify — add graph agent test |
| `libs/agent-studio/src/index.ts` | Modify — export 3 new config types for frontend consumption |
| `apps/web-ui/components/agents/config/whatsapp-trigger-node-form.tsx` | Create — config form for WhatsApp Trigger node |
| `apps/web-ui/components/agents/config/whatsapp-send-node-form.tsx` | Create — config form for WhatsApp Send node |
| `apps/web-ui/components/agents/config/whatsapp-send-template-node-form.tsx` | Create — config form for WhatsApp Send Template node |
| `apps/web-ui/components/agents/config/config-panel.tsx` | Modify — import and wire the 3 new forms |

---

## Task 1: Extend Type System

**Files:**
- Modify: `libs/agent-studio/src/types/nodes.ts`

- [ ] **Step 1: Add the three config interfaces after `DelayNodeConfig` (line 157)**

Open `libs/agent-studio/src/types/nodes.ts`. After the `DelayNodeConfig` interface (around line 157), add:

```typescript
export interface WhatsAppTriggerNodeConfig {
  type: 'whatsapp_trigger';
  channelMap?: {
    senderIdChannel?: string;
    messageTextChannel?: string;
    messageTypeChannel?: string;
    mediaIdChannel?: string;
    withinWindowChannel?: string;
  };
}

export interface WhatsAppSendNodeConfig {
  type: 'whatsapp_send';
  messageType: 'text' | 'image' | 'document' | 'audio' | 'video';
  messageChannel: string;
  mediaIdChannel?: string;
  filenameChannel?: string;
}

export interface WhatsAppSendTemplateNodeConfig {
  type: 'whatsapp_send_template';
  templateName: string;
  languageCode: string;
  componentsChannel?: string;
}
```

- [ ] **Step 2: Extend the `NodeType` union (line 3)**

Change:
```typescript
export type NodeType = 'llm' | 'tool' | 'router' | 'state_schema' | 'input' | 'output' | 'memory' | 'knowledge_base' | 'mcp_server' | 'code' | 'condition' | 'http' | 'human' | 'parallel' | 'sub_agent' | 'delay';
```
To:
```typescript
export type NodeType = 'llm' | 'tool' | 'router' | 'state_schema' | 'input' | 'output' | 'memory' | 'knowledge_base' | 'mcp_server' | 'code' | 'condition' | 'http' | 'human' | 'parallel' | 'sub_agent' | 'delay' | 'whatsapp_trigger' | 'whatsapp_send' | 'whatsapp_send_template';
```

- [ ] **Step 3: Extend the `NodeConfig` discriminated union (around line 160)**

Change the `NodeConfig` type to add the three new members:
```typescript
export type NodeConfig =
  | LlmNodeConfig
  | ToolNodeConfig
  | RouterNodeConfig
  | StateSchemaNodeConfig
  | InputNodeConfig
  | OutputNodeConfig
  | MemoryNodeConfig
  | KnowledgeBaseNodeConfig
  | McpServerNodeConfig
  | CodeNodeConfig
  | ConditionNodeConfig
  | HttpNodeConfig
  | HumanNodeConfig
  | ParallelNodeConfig
  | SubAgentNodeConfig
  | DelayNodeConfig
  | WhatsAppTriggerNodeConfig
  | WhatsAppSendNodeConfig
  | WhatsAppSendTemplateNodeConfig;
```

- [ ] **Step 4: Verify TypeScript is happy**

```bash
cd /path/to/repo && bunx tsc --noEmit -p libs/agent-studio/tsconfig.json 2>&1 | head -20
```
Expected: no errors (or only pre-existing ones unrelated to nodes.ts).

- [ ] **Step 5: Commit**

```bash
git add libs/agent-studio/src/types/nodes.ts
git commit -m "feat(agent-studio): add WhatsApp node config types to NodeType and NodeConfig unions"
```

---

## Task 2: Zod Schemas

**Files:**
- Create: `libs/agent-studio/src/registry/schemas/whatsapp-trigger.ts`
- Create: `libs/agent-studio/src/registry/schemas/whatsapp-send.ts`
- Create: `libs/agent-studio/src/registry/schemas/whatsapp-send-template.ts`

- [ ] **Step 1: Create `whatsapp-trigger.ts`**

```typescript
import { z } from 'zod';

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

- [ ] **Step 2: Create `whatsapp-send.ts`**

```typescript
import { z } from 'zod';

export const whatsappSendNodeSchema = z.object({
  type: z.literal('whatsapp_send'),
  messageType: z.enum(['text', 'image', 'document', 'audio', 'video']),
  messageChannel: z.string().min(1, 'Message channel is required'),
  mediaIdChannel: z.string().optional(),
  filenameChannel: z.string().optional(),
});
```

- [ ] **Step 3: Create `whatsapp-send-template.ts`**

```typescript
import { z } from 'zod';

export const whatsappSendTemplateNodeSchema = z.object({
  type: z.literal('whatsapp_send_template'),
  templateName: z.string().min(1, 'Template name is required'),
  languageCode: z.string().min(2, 'Language code is required'),
  componentsChannel: z.string().optional(),
});
```

- [ ] **Step 4: Register schemas and definitions in `node-registry.ts`**

Open `libs/agent-studio/src/registry/node-registry.ts`. Add these imports at the top with the other schema imports:

```typescript
import { whatsappTriggerNodeSchema } from './schemas/whatsapp-trigger';
import { whatsappSendNodeSchema } from './schemas/whatsapp-send';
import { whatsappSendTemplateNodeSchema } from './schemas/whatsapp-send-template';
```

Add the three schemas to the `nodeConfigSchema` discriminated union (around line 21):
```typescript
const nodeConfigSchema = z.discriminatedUnion('type', [
  llmNodeSchema,
  toolNodeSchema,
  routerNodeSchema,
  stateSchemaNodeSchema,
  inputNodeSchema,
  outputNodeSchema,
  memoryNodeSchema,
  knowledgeBaseNodeSchema,
  mcpServerNodeSchema,
  codeNodeSchema,
  conditionNodeSchema,
  httpNodeSchema,
  humanNodeSchema,
  parallelNodeSchema,
  subAgentNodeSchema,
  delayNodeSchema,
  whatsappTriggerNodeSchema,
  whatsappSendNodeSchema,
  whatsappSendTemplateNodeSchema,
]);
```

Add three `NodeDefinition` entries to the `definitions` array (after the `delay` entry):
```typescript
  {
    type: 'whatsapp_trigger',
    label: 'WhatsApp Trigger',
    description: 'Entry point for WhatsApp-driven graphs. Reads inbound message data into state channels.',
    defaultConfig: {
      type: 'whatsapp_trigger',
    },
    validate(config) {
      const result = whatsappTriggerNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'whatsapp_send',
    label: 'WhatsApp Send',
    description: 'Sends a freeform message to the WhatsApp sender. Only valid within the 24-hour customer service window.',
    defaultConfig: {
      type: 'whatsapp_send',
      messageType: 'text',
      messageChannel: 'llm_output',
    },
    validate(config) {
      const result = whatsappSendNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
  {
    type: 'whatsapp_send_template',
    label: 'WhatsApp Send Template',
    description: 'Sends a pre-approved template message. Works outside the 24-hour window.',
    defaultConfig: {
      type: 'whatsapp_send_template',
      templateName: '',
      languageCode: 'en',
    },
    validate(config) {
      const result = whatsappSendTemplateNodeSchema.safeParse(config);
      if (result.success) return [];
      return result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
    },
  },
```

- [ ] **Step 5: Commit**

```bash
git add libs/agent-studio/src/registry/schemas/whatsapp-trigger.ts \
        libs/agent-studio/src/registry/schemas/whatsapp-send.ts \
        libs/agent-studio/src/registry/schemas/whatsapp-send-template.ts \
        libs/agent-studio/src/registry/node-registry.ts
git commit -m "feat(agent-studio): add WhatsApp node Zod schemas and registry definitions"
```

---

## Task 3: WhatsApp Trigger Executor

**Files:**
- Create: `libs/agent-studio/src/execution/node-executors/whatsapp-trigger-executor.ts`
- Create: `libs/agent-studio/src/execution/node-executors/whatsapp-trigger-executor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/agent-studio/src/execution/node-executors/whatsapp-trigger-executor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { WhatsAppTriggerNodeExecutor } from './whatsapp-trigger-executor';
import type { NodeExecutionContext } from '../types';

function makeCtx(channels: Record<string, unknown>, config = {}): NodeExecutionContext {
  return {
    state: {
      channels,
      messages: [],
      currentNodeId: 'node_1',
      metadata: { executionId: 'e1', agentId: 'a1', tenantId: 't1', userId: 'whatsapp', startedAt: new Date() },
    },
    node: { id: 'node_1', type: 'whatsapp_trigger', label: 'WA Trigger', position: { x: 0, y: 0 }, config: {} },
    config: { type: 'whatsapp_trigger', ...config },
    services: { llmProvider: async () => ({}), prisma: {} },
    emit: () => {},
  };
}

describe('WhatsAppTriggerNodeExecutor', () => {
  const executor = new WhatsAppTriggerNodeExecutor();

  it('has type whatsapp_trigger', () => {
    expect(executor.type).toBe('whatsapp_trigger');
  });

  it('passes through wa_* channels into stateUpdates', async () => {
    const ctx = makeCtx({
      wa_sender_id: '919876543210',
      wa_message_text: 'Hello',
      wa_message_type: 'text',
      wa_media_id: null,
      wa_phone_number_id: 'phone_123',
      wa_account_id: 'acc_1',
      wa_session_id: 'sess_1',
      wa_within_window: true,
    });

    const result = await executor.execute(ctx);

    expect(result.stateUpdates).toMatchObject({
      wa_sender_id: '919876543210',
      wa_message_text: 'Hello',
      wa_message_type: 'text',
      wa_within_window: true,
    });
    expect(result.trace.status).toBe('completed');
  });

  it('throws when wa_sender_id is missing', async () => {
    const ctx = makeCtx({ wa_phone_number_id: 'phone_123' });
    await expect(executor.execute(ctx)).rejects.toThrow('wa_sender_id');
  });

  it('throws when wa_phone_number_id is missing', async () => {
    const ctx = makeCtx({ wa_sender_id: '919876543210' });
    await expect(executor.execute(ctx)).rejects.toThrow('wa_phone_number_id');
  });

  it('remaps channels when channelMap is configured', async () => {
    const ctx = makeCtx(
      { wa_sender_id: '919876543210', wa_message_text: 'Hi', wa_phone_number_id: 'phone_123' },
      { channelMap: { messageTextChannel: 'user_input' } },
    );

    const result = await executor.execute(ctx);

    expect(result.stateUpdates['user_input']).toBe('Hi');
    expect(result.stateUpdates['wa_message_text']).toBe('Hi');
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd /path/to/repo && bunx vitest run libs/agent-studio/src/execution/node-executors/whatsapp-trigger-executor.test.ts 2>&1 | tail -10
```
Expected: FAIL — `Cannot find module './whatsapp-trigger-executor'`

- [ ] **Step 3: Implement the executor**

Create `libs/agent-studio/src/execution/node-executors/whatsapp-trigger-executor.ts`:

```typescript
import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { WhatsAppTriggerNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:whatsapp-trigger-executor');

export class WhatsAppTriggerNodeExecutor implements NodeExecutor {
  type = 'whatsapp_trigger';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as WhatsAppTriggerNodeConfig;
    const startedAt = new Date().toISOString();
    const { channels } = ctx.state;

    const senderId = channels['wa_sender_id'];
    const phoneNumberId = channels['wa_phone_number_id'];

    if (!senderId) throw new Error('WhatsApp Trigger: wa_sender_id is missing from state — this node must be started via the WhatsApp webhook');
    if (!phoneNumberId) throw new Error('WhatsApp Trigger: wa_phone_number_id is missing from state — this node must be started via the WhatsApp webhook');

    const updates: Record<string, unknown> = {
      wa_sender_id: senderId,
      wa_message_text: channels['wa_message_text'] ?? '',
      wa_message_type: channels['wa_message_type'] ?? 'text',
      wa_media_id: channels['wa_media_id'] ?? null,
      wa_phone_number_id: phoneNumberId,
      wa_account_id: channels['wa_account_id'] ?? null,
      wa_session_id: channels['wa_session_id'] ?? null,
      wa_within_window: channels['wa_within_window'] ?? false,
    };

    if (config.channelMap) {
      const map = config.channelMap;
      if (map.senderIdChannel) updates[map.senderIdChannel] = senderId;
      if (map.messageTextChannel) updates[map.messageTextChannel] = updates['wa_message_text'];
      if (map.messageTypeChannel) updates[map.messageTypeChannel] = updates['wa_message_type'];
      if (map.mediaIdChannel) updates[map.mediaIdChannel] = updates['wa_media_id'];
      if (map.withinWindowChannel) updates[map.withinWindowChannel] = updates['wa_within_window'];
    }

    logger.info({ nodeId: ctx.node.id, senderId, messageType: updates['wa_message_type'] }, 'WhatsApp trigger processed');

    return {
      stateUpdates: updates,
      next: null,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'whatsapp_trigger',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { senderId, messageType: updates['wa_message_type'] },
        output: { channelsWritten: Object.keys(updates) },
      },
    };
  }
}
```

- [ ] **Step 4: Run test — confirm it passes**

```bash
bunx vitest run libs/agent-studio/src/execution/node-executors/whatsapp-trigger-executor.test.ts 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add libs/agent-studio/src/execution/node-executors/whatsapp-trigger-executor.ts \
        libs/agent-studio/src/execution/node-executors/whatsapp-trigger-executor.test.ts
git commit -m "feat(agent-studio): add WhatsApp trigger node executor with tests"
```

---

## Task 4: WhatsApp Send Executor

**Files:**
- Create: `libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.ts`
- Create: `libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MetaWhatsAppClient before importing executor
vi.mock('@chatbot/whatsapp', () => ({
  MetaWhatsAppClient: vi.fn().mockImplementation(() => ({
    sendTextMessage: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.abc' }] }),
    sendImageMessage: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.img' }] }),
    sendDocumentMessage: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.doc' }] }),
  })),
}));

vi.mock('@chatbot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatbot/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    EncryptionService: vi.fn().mockImplementation(() => ({
      decrypt: vi.fn().mockReturnValue('decrypted-access-token'),
    })),
  };
});

import { WhatsAppSendNodeExecutor } from './whatsapp-send-executor';
import type { NodeExecutionContext } from '../types';

function makeCtx(channels: Record<string, unknown>, config: Record<string, unknown> = {}): NodeExecutionContext {
  const mockPrisma = {
    whatsAppAccount: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'acc_1',
        accessToken: 'encrypted-token',
        phoneNumberId: 'phone_123',
        apiVersion: 'v22.0',
      }),
    },
  };
  return {
    state: {
      channels: {
        wa_sender_id: '919876543210',
        wa_phone_number_id: 'phone_123',
        wa_account_id: 'acc_1',
        ...channels,
      },
      messages: [],
      currentNodeId: 'node_1',
      metadata: { executionId: 'e1', agentId: 'a1', tenantId: 't1', userId: 'whatsapp', startedAt: new Date() },
    },
    node: { id: 'node_1', type: 'whatsapp_send', label: 'WA Send', position: { x: 0, y: 0 }, config: {} },
    config: { type: 'whatsapp_send', messageType: 'text', messageChannel: 'llm_output', ...config },
    services: { llmProvider: async () => ({}), prisma: mockPrisma },
    emit: () => {},
  };
}

describe('WhatsAppSendNodeExecutor', () => {
  const executor = new WhatsAppSendNodeExecutor();

  beforeEach(() => { vi.clearAllMocks(); });

  it('has type whatsapp_send', () => {
    expect(executor.type).toBe('whatsapp_send');
  });

  it('sends text message and returns wa_last_sent_message_id', async () => {
    const ctx = makeCtx({ llm_output: 'Hello there!' });
    const result = await executor.execute(ctx);
    expect(result.stateUpdates['wa_last_sent_message_id']).toBe('wamid.abc');
    expect(result.trace.status).toBe('completed');
  });

  it('throws when wa_sender_id is missing', async () => {
    const ctx = makeCtx({ llm_output: 'Hi' });
    (ctx.state.channels as any)['wa_sender_id'] = undefined;
    await expect(executor.execute(ctx)).rejects.toThrow('wa_sender_id');
  });

  it('throws when wa_account_id is missing', async () => {
    const ctx = makeCtx({ llm_output: 'Hi' });
    (ctx.state.channels as any)['wa_account_id'] = undefined;
    await expect(executor.execute(ctx)).rejects.toThrow('wa_account_id');
  });

  it('throws when message channel is empty', async () => {
    const ctx = makeCtx({ llm_output: '' });
    await expect(executor.execute(ctx)).rejects.toThrow('empty');
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
bunx vitest run libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.test.ts 2>&1 | tail -10
```
Expected: FAIL — `Cannot find module './whatsapp-send-executor'`

- [ ] **Step 3: Implement the executor**

Create `libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.ts`:

```typescript
import { createLogger, EncryptionService } from '@chatbot/shared';
import { MetaWhatsAppClient } from '@chatbot/whatsapp';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { WhatsAppSendNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:whatsapp-send-executor');

export class WhatsAppSendNodeExecutor implements NodeExecutor {
  type = 'whatsapp_send';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as WhatsAppSendNodeConfig;
    const startedAt = new Date().toISOString();
    const { channels } = ctx.state;

    const senderId = channels['wa_sender_id'] as string | undefined;
    const accountId = channels['wa_account_id'] as string | undefined;

    if (!senderId) throw new Error('WhatsApp Send: wa_sender_id is missing from state channels');
    if (!accountId) throw new Error('WhatsApp Send: wa_account_id is missing from state channels');

    const messageContent = channels[config.messageChannel];
    if (!messageContent && messageContent !== 0) {
      throw new Error(`WhatsApp Send: message channel "${config.messageChannel}" is empty`);
    }

    const account = await ctx.services.prisma.whatsAppAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new Error(`WhatsApp Send: WhatsAppAccount not found for id ${accountId}`);

    const encryption = new EncryptionService();
    const accessToken = encryption.decrypt(account.accessToken);

    const client = new MetaWhatsAppClient({
      accessToken,
      phoneNumberId: account.phoneNumberId,
      apiVersion: account.apiVersion ?? 'v22.0',
    });

    let sentMessageId: string;

    switch (config.messageType) {
      case 'text': {
        const response = await client.sendTextMessage(senderId, String(messageContent));
        sentMessageId = response.messages[0].id;
        break;
      }
      case 'image': {
        const mediaId = channels[config.mediaIdChannel ?? ''] as string;
        const caption = channels[config.messageChannel] as string | undefined;
        const response = await client.sendImageMessage(senderId, mediaId, caption);
        sentMessageId = response.messages[0].id;
        break;
      }
      case 'document': {
        const mediaId = channels[config.mediaIdChannel ?? ''] as string;
        const filename = config.filenameChannel ? channels[config.filenameChannel] as string : undefined;
        const caption = channels[config.messageChannel] as string | undefined;
        const response = await client.sendDocumentMessage(senderId, mediaId, filename, caption);
        sentMessageId = response.messages[0].id;
        break;
      }
      default:
        throw new Error(`WhatsApp Send: unsupported messageType "${config.messageType}"`);
    }

    logger.info({ nodeId: ctx.node.id, senderId, messageType: config.messageType, sentMessageId }, 'WhatsApp message sent');

    return {
      stateUpdates: { wa_last_sent_message_id: sentMessageId },
      next: null,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'whatsapp_send',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { senderId, messageType: config.messageType, channel: config.messageChannel },
        output: { sentMessageId },
      },
    };
  }
}
```

- [ ] **Step 4: Run test — confirm it passes**

```bash
bunx vitest run libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.test.ts 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.ts \
        libs/agent-studio/src/execution/node-executors/whatsapp-send-executor.test.ts
git commit -m "feat(agent-studio): add WhatsApp send node executor with tests"
```

---

## Task 5: WhatsApp Send Template Executor

**Files:**
- Create: `libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.ts`
- Create: `libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendTemplateMessage = vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.tpl' }] });

vi.mock('@chatbot/whatsapp', () => ({
  MetaWhatsAppClient: vi.fn().mockImplementation(() => ({
    sendTemplateMessage: mockSendTemplateMessage,
  })),
}));

vi.mock('@chatbot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatbot/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    EncryptionService: vi.fn().mockImplementation(() => ({
      decrypt: vi.fn().mockReturnValue('decrypted-token'),
    })),
  };
});

import { WhatsAppSendTemplateNodeExecutor } from './whatsapp-send-template-executor';
import type { NodeExecutionContext } from '../types';

function makeCtx(channels: Record<string, unknown> = {}, config: Record<string, unknown> = {}): NodeExecutionContext {
  const mockPrisma = {
    whatsAppAccount: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'acc_1',
        accessToken: 'encrypted-token',
        phoneNumberId: 'phone_123',
        apiVersion: 'v22.0',
      }),
    },
  };
  return {
    state: {
      channels: {
        wa_sender_id: '919876543210',
        wa_account_id: 'acc_1',
        ...channels,
      },
      messages: [],
      currentNodeId: 'node_1',
      metadata: { executionId: 'e1', agentId: 'a1', tenantId: 't1', userId: 'whatsapp', startedAt: new Date() },
    },
    node: { id: 'node_1', type: 'whatsapp_send_template', label: 'WA Template', position: { x: 0, y: 0 }, config: {} },
    config: { type: 'whatsapp_send_template', templateName: 'hello_world', languageCode: 'en', ...config },
    services: { llmProvider: async () => ({}), prisma: mockPrisma },
    emit: () => {},
  };
}

describe('WhatsAppSendTemplateNodeExecutor', () => {
  const executor = new WhatsAppSendTemplateNodeExecutor();

  beforeEach(() => { vi.clearAllMocks(); });

  it('has type whatsapp_send_template', () => {
    expect(executor.type).toBe('whatsapp_send_template');
  });

  it('sends template without components and returns wa_last_sent_message_id', async () => {
    const ctx = makeCtx();
    const result = await executor.execute(ctx);
    expect(result.stateUpdates['wa_last_sent_message_id']).toBe('wamid.tpl');
    expect(mockSendTemplateMessage).toHaveBeenCalledWith('919876543210', 'hello_world', 'en', undefined);
  });

  it('parses components from channel when componentsChannel is set', async () => {
    const components = [{ type: 'body', parameters: [{ type: 'text', text: 'Omar' }] }];
    const ctx = makeCtx(
      { tpl_components: JSON.stringify(components) },
      { componentsChannel: 'tpl_components' },
    );
    await executor.execute(ctx);
    expect(mockSendTemplateMessage).toHaveBeenCalledWith('919876543210', 'hello_world', 'en', components);
  });

  it('accepts components channel value already parsed as array', async () => {
    const components = [{ type: 'body', parameters: [] }];
    const ctx = makeCtx({ tpl_components: components }, { componentsChannel: 'tpl_components' });
    await executor.execute(ctx);
    expect(mockSendTemplateMessage).toHaveBeenCalledWith('919876543210', 'hello_world', 'en', components);
  });

  it('throws when wa_sender_id is missing', async () => {
    const ctx = makeCtx();
    (ctx.state.channels as any)['wa_sender_id'] = undefined;
    await expect(executor.execute(ctx)).rejects.toThrow('wa_sender_id');
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
bunx vitest run libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.test.ts 2>&1 | tail -10
```
Expected: FAIL — `Cannot find module './whatsapp-send-template-executor'`

- [ ] **Step 3: Implement the executor**

Create `libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.ts`:

```typescript
import { createLogger, EncryptionService } from '@chatbot/shared';
import { MetaWhatsAppClient } from '@chatbot/whatsapp';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { WhatsAppSendTemplateNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:whatsapp-send-template-executor');

export class WhatsAppSendTemplateNodeExecutor implements NodeExecutor {
  type = 'whatsapp_send_template';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as WhatsAppSendTemplateNodeConfig;
    const startedAt = new Date().toISOString();
    const { channels } = ctx.state;

    const senderId = channels['wa_sender_id'] as string | undefined;
    const accountId = channels['wa_account_id'] as string | undefined;

    if (!senderId) throw new Error('WhatsApp Send Template: wa_sender_id is missing from state channels');
    if (!accountId) throw new Error('WhatsApp Send Template: wa_account_id is missing from state channels');

    const account = await ctx.services.prisma.whatsAppAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new Error(`WhatsApp Send Template: WhatsAppAccount not found for id ${accountId}`);

    const encryption = new EncryptionService();
    const accessToken = encryption.decrypt(account.accessToken);

    const client = new MetaWhatsAppClient({
      accessToken,
      phoneNumberId: account.phoneNumberId,
      apiVersion: account.apiVersion ?? 'v22.0',
    });

    let components: unknown[] | undefined;
    if (config.componentsChannel) {
      const raw = channels[config.componentsChannel];
      if (raw != null) {
        components = Array.isArray(raw) ? raw : JSON.parse(String(raw));
      }
    }

    const response = await client.sendTemplateMessage(
      senderId,
      config.templateName,
      config.languageCode,
      components as any,
    );
    const sentMessageId = response.messages[0].id;

    logger.info({ nodeId: ctx.node.id, senderId, templateName: config.templateName, sentMessageId }, 'WhatsApp template sent');

    return {
      stateUpdates: { wa_last_sent_message_id: sentMessageId },
      next: null,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'whatsapp_send_template',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { senderId, templateName: config.templateName, languageCode: config.languageCode },
        output: { sentMessageId },
      },
    };
  }
}
```

- [ ] **Step 4: Run test — confirm it passes**

```bash
bunx vitest run libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.test.ts 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.ts \
        libs/agent-studio/src/execution/node-executors/whatsapp-send-template-executor.test.ts
git commit -m "feat(agent-studio): add WhatsApp send template node executor with tests"
```

---

## Task 6: Wire Executors into Index and Server

**Files:**
- Modify: `libs/agent-studio/src/execution/node-executors/index.ts`
- Modify: `libs/agent-studio/src/server.ts`

- [ ] **Step 1: Export new executors from index.ts**

Open `libs/agent-studio/src/execution/node-executors/index.ts`. Add three exports at the end:

```typescript
export { WhatsAppTriggerNodeExecutor } from './whatsapp-trigger-executor';
export { WhatsAppSendNodeExecutor } from './whatsapp-send-executor';
export { WhatsAppSendTemplateNodeExecutor } from './whatsapp-send-template-executor';
```

- [ ] **Step 2: Register in server.ts**

Open `libs/agent-studio/src/server.ts`. Add the three imports alongside the existing executor imports:

```typescript
import {
  // ... existing imports ...
  WhatsAppTriggerNodeExecutor,
  WhatsAppSendNodeExecutor,
  WhatsAppSendTemplateNodeExecutor,
} from './execution/node-executors';
```

Add the three exports alongside existing ones:
```typescript
export {
  // ... existing exports ...
  WhatsAppTriggerNodeExecutor,
  WhatsAppSendNodeExecutor,
  WhatsAppSendTemplateNodeExecutor,
};
```

Add three new instances to `createNodeExecutors()`:
```typescript
export function createNodeExecutors(): NodeExecutor[] {
  return [
    new LlmNodeExecutor(),
    new RouterNodeExecutor(),
    new ToolNodeExecutor(),
    new StateSchemaNodeExecutor(),
    new InputNodeExecutor(),
    new OutputNodeExecutor(),
    new MemoryNodeExecutor(),
    new KnowledgeBaseNodeExecutor(),
    new McpServerNodeExecutor(),
    new CodeNodeExecutor(),
    new ConditionNodeExecutor(),
    new HttpNodeExecutor(),
    new HumanNodeExecutor(),
    new ParallelNodeExecutor(),
    new SubAgentNodeExecutor(),
    new DelayNodeExecutor(),
    new WhatsAppTriggerNodeExecutor(),
    new WhatsAppSendNodeExecutor(),
    new WhatsAppSendTemplateNodeExecutor(),
  ];
}
```

- [ ] **Step 3: Run all agent-studio tests**

```bash
bunx vitest run --project agent-studio 2>&1 | tail -20
```
Expected: all previously passing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add libs/agent-studio/src/execution/node-executors/index.ts \
        libs/agent-studio/src/server.ts
git commit -m "feat(agent-studio): register WhatsApp node executors in index and server"
```

---

## Task 7: Enrich MessageProcessor Context

**Files:**
- Modify: `libs/whatsapp/src/processor/message-processor.ts`

The `MessageProcessor` currently calls `agentExecutor.execute(session.agentId, { text: messageText }, session.context ?? {})`. The context needs `wa_*` fields, and the send step must be skipped when the graph handled sending itself (indicated by `agentResponse.text === ''`).

- [ ] **Step 1: Update the `agentExecutor.execute()` call and send step**

Open `libs/whatsapp/src/processor/message-processor.ts`. Find the section starting at line 109 (`const agentResponse = await...`) through line 130 (`await this.deps.sessionManager.refreshWindow(session.id)`).

Replace it with:

```typescript
      const withinWindow = session.lastMessageAt
        ? Date.now() - new Date(session.lastMessageAt).getTime() < 24 * 60 * 60 * 1000
        : true;

      const mediaId = this.extractMediaId(message);

      const agentResponse = await this.deps.agentExecutor.execute(
        session.agentId,
        { text: messageText, mediaType: message.type, mediaId: mediaId ?? undefined },
        {
          ...(session.context ?? {}),
          wa_sender_id: contact.wa_id,
          wa_message_type: message.type,
          wa_media_id: mediaId,
          wa_phone_number_id: phoneNumberId,
          wa_account_id: account.id,
          wa_session_id: session.id,
          wa_within_window: withinWindow,
          tenantId: account.tenantId,
        },
      );

      // Only send via MessageProcessor when the graph did not handle sending itself.
      // Graph agents with whatsapp_send nodes return text: '' to signal self-handled delivery.
      if (agentResponse.text) {
        const metaClient = this.deps.metaClientFactory(account.accessToken, account.phoneNumberId);
        const sendResult = await metaClient.sendTextMessage(contact.wa_id, agentResponse.text);
        this.deps.circuitBreaker.recordSuccess();

        await (this.deps.prisma as any).whatsAppMessage.create({
          data: {
            accountId: account.id,
            sessionId: session.id,
            waMessageId: sendResult.messages[0].id,
            direction: 'outbound',
            contactPhone: contact.wa_id,
            type: 'text',
            content: { text: agentResponse.text },
            status: 'sent',
          },
        });
      } else {
        this.deps.circuitBreaker.recordSuccess();
      }

      await this.deps.sessionManager.refreshWindow(session.id);
```

- [ ] **Step 2: Add `extractMediaId` private helper method**

Add this private method to the `MessageProcessor` class (after `extractContent`):

```typescript
  private extractMediaId(message: any): string | null {
    return message.image?.id
      ?? message.video?.id
      ?? message.audio?.id
      ?? message.document?.id
      ?? message.sticker?.id
      ?? null;
  }
```

- [ ] **Step 3: Run WhatsApp tests**

```bash
bunx vitest run --project whatsapp 2>&1 | tail -20
```
Expected: all previously passing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add libs/whatsapp/src/processor/message-processor.ts
git commit -m "feat(whatsapp): enrich agent executor context with wa_* fields and conditional send"
```

---

## Task 8: Replace executeGraphAgent Stub

**Files:**
- Modify: `libs/whatsapp/src/processor/agent-executor.ts`
- Modify: `libs/whatsapp/src/processor/agent-executor.test.ts`

- [ ] **Step 1: Write the new failing test**

Open `libs/whatsapp/src/processor/agent-executor.test.ts`. Add this test at the end of the file (inside the existing `describe` block):

```typescript
  it('executes a graph agent using GraphExecutor and returns response from output channel', async () => {
    const mockFinalState = {
      channels: { response: 'Hello from graph!' },
      messages: [],
      currentNodeId: null,
      metadata: { executionId: 'e1', agentId: 'graph_agent_1', tenantId: 't1', userId: 'whatsapp', startedAt: new Date() },
    };

    const mockGraphExecutor = {
      register: vi.fn(),
      executeFromState: vi.fn().mockResolvedValue(mockFinalState),
    };

    vi.mock('@chatbot/agent-studio/server', () => ({
      GraphExecutor: vi.fn().mockImplementation(() => mockGraphExecutor),
      createNodeExecutors: vi.fn().mockReturnValue([]),
    }));

    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'graph_agent_1',
      type: 'graph',
      config: {
        nodes: [{ id: 'n1', type: 'whatsapp_trigger', config: { type: 'whatsapp_trigger' } }],
        edges: [],
      },
    });

    const result = await executor.execute(
      'graph_agent_1',
      { text: 'Hi from WhatsApp' },
      {
        wa_sender_id: '919876543210',
        wa_phone_number_id: 'phone_123',
        wa_account_id: 'acc_1',
        wa_session_id: 'sess_1',
        wa_within_window: true,
        wa_message_type: 'text',
        wa_media_id: null,
        tenantId: 'tenant_1',
      },
    );

    expect(result.text).toBe('Hello from graph!');
  });
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
bunx vitest run libs/whatsapp/src/processor/agent-executor.test.ts 2>&1 | tail -10
```
Expected: FAIL.

- [ ] **Step 3: Replace executeGraphAgent with real implementation**

Open `libs/whatsapp/src/processor/agent-executor.ts`. Replace the entire file with:

```typescript
import type { PrismaClient } from '@prisma/client';
import type { AgentExecutor } from './message-processor';

export type LlmProviderFactory = (config: { model: string; temperature?: number }) => {
  chat(params: { messages: Array<{ role: string; content: string }>; maxTokens?: number }): Promise<{ text: string }>;
};

export class WhatsAppAgentExecutor implements AgentExecutor {
  private readonly prisma: PrismaClient;
  private readonly providerFactory: LlmProviderFactory;

  constructor(prisma: PrismaClient, providerFactory: LlmProviderFactory) {
    this.prisma = prisma;
    this.providerFactory = providerFactory;
  }

  async execute(
    agentId: string,
    message: { text?: string; mediaUrl?: string; mediaType?: string; mediaId?: string },
    context: Record<string, unknown>,
  ): Promise<{ text: string }> {
    const agent = await (this.prisma as any).agent.findFirst({
      where: { id: agentId },
    });

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (agent.type === 'simple') {
      return this.executeSimpleAgent(agent, message, context);
    }

    if (agent.type === 'graph') {
      return this.executeGraphAgent(agent, message, context);
    }

    throw new Error(`Unsupported agent type: ${agent.type}`);
  }

  private async executeSimpleAgent(
    agent: { id: string; config: any },
    message: { text?: string },
    context: Record<string, unknown>,
  ): Promise<{ text: string }> {
    const config = agent.config as { model: string; systemPrompt: string; temperature?: number; maxTokens?: number };
    const provider = this.providerFactory({ model: config.model, temperature: config.temperature });

    const messages: Array<{ role: string; content: string }> = [];
    messages.push({ role: 'system', content: config.systemPrompt });

    const history = (context.messages as Array<{ role: string; content: string }>) ?? [];
    messages.push(...history);

    if (message.text) {
      messages.push({ role: 'user', content: message.text });
    }

    const result = await provider.chat({ messages, maxTokens: config.maxTokens });
    return { text: result.text };
  }

  private async executeGraphAgent(
    agent: { id: string; config: any },
    message: { text?: string; mediaId?: string; mediaType?: string },
    context: Record<string, unknown>,
  ): Promise<{ text: string }> {
    const { GraphExecutor, createNodeExecutors } = await import('@chatbot/agent-studio/server');

    const graphDef = agent.config as { nodes: any[]; edges: any[] };

    // Find entry node: prefer whatsapp_trigger, fall back to node with no incoming edges
    const entryNode =
      graphDef.nodes.find((n: any) => n.type === 'whatsapp_trigger') ??
      graphDef.nodes.find((n: any) => graphDef.edges.every((e: any) => e.target !== n.id));

    if (!entryNode) throw new Error(`Graph agent ${agent.id} has no entry node`);

    const initialState = {
      channels: {
        wa_sender_id: context['wa_sender_id'] ?? '',
        wa_message_text: message.text ?? '',
        wa_message_type: context['wa_message_type'] ?? 'text',
        wa_media_id: context['wa_media_id'] ?? null,
        wa_phone_number_id: context['wa_phone_number_id'] ?? '',
        wa_account_id: context['wa_account_id'] ?? '',
        wa_session_id: context['wa_session_id'] ?? '',
        wa_within_window: context['wa_within_window'] ?? false,
        messages: (context['messages'] as any[]) ?? [],
      },
      messages: (context['messages'] as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>) ?? [],
      currentNodeId: entryNode.id as string,
      metadata: {
        executionId: crypto.randomUUID(),
        agentId: agent.id,
        tenantId: (context['tenantId'] as string) ?? '',
        userId: 'whatsapp',
        startedAt: new Date(),
      },
    };

    const executor = new GraphExecutor({
      llmProvider: this.providerFactory as any,
      prisma: this.prisma,
    });

    for (const nodeExecutor of createNodeExecutors()) {
      executor.register(nodeExecutor);
    }

    const finalState = await executor.executeFromState(
      graphDef,
      initialState,
      initialState.metadata,
    );

    // If the graph contained a whatsapp_send node, it already sent the reply.
    // Signal this to MessageProcessor by returning empty text.
    if (finalState.channels['wa_last_sent_message_id']) {
      return { text: '' };
    }

    // Otherwise return text from standard output channels for MessageProcessor to send.
    const responseText =
      String(finalState.channels['response'] ?? finalState.channels['llm_output'] ?? '');

    return { text: responseText };
  }
}
```

- [ ] **Step 4: Run all WhatsApp tests**

```bash
bunx vitest run --project whatsapp 2>&1 | tail -20
```
Expected: all tests pass including the new graph agent test.

- [ ] **Step 5: Run full test suite**

```bash
bun run test 2>&1 | tail -20
```
Expected: same pass/fail count as before (2 pre-existing failures, everything else passes).

- [ ] **Step 6: TypeScript check**

```bash
bunx tsc --noEmit 2>&1 | head -30
```
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add libs/whatsapp/src/processor/agent-executor.ts \
        libs/whatsapp/src/processor/agent-executor.test.ts
git commit -m "feat(whatsapp): replace executeGraphAgent stub with real GraphExecutor integration"
```

---

## Task 9: Frontend Node Config Forms

**Files:**
- Modify: `libs/agent-studio/src/index.ts`
- Create: `apps/web-ui/components/agents/config/whatsapp-trigger-node-form.tsx`
- Create: `apps/web-ui/components/agents/config/whatsapp-send-node-form.tsx`
- Create: `apps/web-ui/components/agents/config/whatsapp-send-template-node-form.tsx`
- Modify: `apps/web-ui/components/agents/config/config-panel.tsx`

The graph canvas config panel renders a form component per node type. Without forms, clicking a WhatsApp node shows the panel header but nothing else. This task adds the three forms and wires them in.

**Pattern:** Follow `human-node-form.tsx` exactly — `useForm` from `@tanstack/react-form`, Zod schema for validation, `onBlur` triggers `form.handleSubmit()`, props are `{ config, onChange }`.

- [ ] **Step 1: Export the 3 new config types from `libs/agent-studio/src/index.ts`**

Open `libs/agent-studio/src/index.ts`. Add the three new types to the existing `export type { ... } from './types/nodes'` block alongside `DelayNodeConfig`:

```typescript
  DelayNodeConfig,
  WhatsAppTriggerNodeConfig,
  WhatsAppSendNodeConfig,
  WhatsAppSendTemplateNodeConfig,
```

- [ ] **Step 2: Create `whatsapp-trigger-node-form.tsx`**

Create `apps/web-ui/components/agents/config/whatsapp-trigger-node-form.tsx`:

```typescript
'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { WhatsAppTriggerNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  senderIdChannel: z.string().optional(),
  messageTextChannel: z.string().optional(),
  messageTypeChannel: z.string().optional(),
  mediaIdChannel: z.string().optional(),
  withinWindowChannel: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  config: WhatsAppTriggerNodeConfig;
  onChange: (config: WhatsAppTriggerNodeConfig) => void;
}

export function WhatsAppTriggerNodeForm({ config, onChange }: Props) {
  const map = config.channelMap ?? {};

  const form = useForm({
    defaultValues: {
      senderIdChannel: map.senderIdChannel ?? '',
      messageTextChannel: map.messageTextChannel ?? '',
      messageTypeChannel: map.messageTypeChannel ?? '',
      mediaIdChannel: map.mediaIdChannel ?? '',
      withinWindowChannel: map.withinWindowChannel ?? '',
    } as FormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      const channelMap: WhatsAppTriggerNodeConfig['channelMap'] = {};
      if (value.senderIdChannel) channelMap.senderIdChannel = value.senderIdChannel;
      if (value.messageTextChannel) channelMap.messageTextChannel = value.messageTextChannel;
      if (value.messageTypeChannel) channelMap.messageTypeChannel = value.messageTypeChannel;
      if (value.mediaIdChannel) channelMap.mediaIdChannel = value.mediaIdChannel;
      if (value.withinWindowChannel) channelMap.withinWindowChannel = value.withinWindowChannel;
      onChange({ type: 'whatsapp_trigger', channelMap: Object.keys(channelMap).length ? channelMap : undefined });
    },
  });

  const handleBlur = () => form.handleSubmit();

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4">
      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Available channels (auto-populated)</p>
        <p><code className="font-mono">wa_sender_id</code> — customer phone</p>
        <p><code className="font-mono">wa_message_text</code> — message body</p>
        <p><code className="font-mono">wa_message_type</code> — text / image / etc.</p>
        <p><code className="font-mono">wa_media_id</code> — media ID if media message</p>
        <p><code className="font-mono">wa_within_window</code> — true if within 24h window</p>
      </div>
      <p className="text-xs text-muted-foreground">Optionally remap channels to custom names. Leave blank to use defaults above.</p>
      {[
        { name: 'senderIdChannel' as const, label: 'Sender ID Channel', placeholder: 'wa_sender_id' },
        { name: 'messageTextChannel' as const, label: 'Message Text Channel', placeholder: 'wa_message_text' },
        { name: 'messageTypeChannel' as const, label: 'Message Type Channel', placeholder: 'wa_message_type' },
        { name: 'mediaIdChannel' as const, label: 'Media ID Channel', placeholder: 'wa_media_id' },
        { name: 'withinWindowChannel' as const, label: 'Within Window Channel', placeholder: 'wa_within_window' },
      ].map(({ name, label, placeholder }) => (
        <form.Field key={name} name={name}>
          {(field) => (
            <div className="grid gap-1.5">
              <Label htmlFor={field.name}>{label}</Label>
              <Input
                id={field.name}
                value={field.state.value ?? ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={() => { field.handleBlur(); handleBlur(); }}
                placeholder={placeholder}
              />
            </div>
          )}
        </form.Field>
      ))}
    </form>
  );
}
```

- [ ] **Step 3: Create `whatsapp-send-node-form.tsx`**

Create `apps/web-ui/components/agents/config/whatsapp-send-node-form.tsx`:

```typescript
'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { WhatsAppSendNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  messageType: z.enum(['text', 'image', 'document', 'audio', 'video']),
  messageChannel: z.string().min(1, 'Message channel is required'),
  mediaIdChannel: z.string().optional(),
  filenameChannel: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  config: WhatsAppSendNodeConfig;
  onChange: (config: WhatsAppSendNodeConfig) => void;
}

export function WhatsAppSendNodeForm({ config, onChange }: Props) {
  const form = useForm({
    defaultValues: {
      messageType: config.messageType ?? 'text',
      messageChannel: config.messageChannel ?? 'llm_output',
      mediaIdChannel: config.mediaIdChannel ?? '',
      filenameChannel: config.filenameChannel ?? '',
    } as FormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'whatsapp_send',
        messageType: value.messageType,
        messageChannel: value.messageChannel,
        mediaIdChannel: value.mediaIdChannel || undefined,
        filenameChannel: value.filenameChannel || undefined,
      });
    },
  });

  const handleBlur = () => form.handleSubmit();

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4">
      <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
        Only valid within the 24-hour customer service window. Use <strong>WhatsApp Send Template</strong> to contact customers outside that window.
      </div>
      <form.Field name="messageType">
        {(field) => (
          <div className="grid gap-1.5">
            <Label>Message Type</Label>
            <Select value={field.state.value} onValueChange={(v) => { field.handleChange(v as FormValues['messageType']); handleBlur(); }}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="image">Image</SelectItem>
                <SelectItem value="document">Document</SelectItem>
                <SelectItem value="audio">Audio</SelectItem>
                <SelectItem value="video">Video</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>
      <form.Field name="messageChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Message Channel</Label>
            <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={() => { field.handleBlur(); handleBlur(); }} placeholder="llm_output" />
            <p className="text-[10px] text-muted-foreground">Channel containing the text body (or caption for media)</p>
            {field.state.meta.errors.length > 0 && <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>}
          </div>
        )}
      </form.Field>
      <form.Field name="mediaIdChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Media ID Channel</Label>
            <Input id={field.name} value={field.state.value ?? ''} onChange={(e) => field.handleChange(e.target.value)} onBlur={() => { field.handleBlur(); handleBlur(); }} placeholder="wa_media_id" />
            <p className="text-[10px] text-muted-foreground">Required for image / document / audio / video types</p>
          </div>
        )}
      </form.Field>
      <form.Field name="filenameChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Filename Channel</Label>
            <Input id={field.name} value={field.state.value ?? ''} onChange={(e) => field.handleChange(e.target.value)} onBlur={() => { field.handleBlur(); handleBlur(); }} placeholder="optional" />
            <p className="text-[10px] text-muted-foreground">Document filename (document type only)</p>
          </div>
        )}
      </form.Field>
    </form>
  );
}
```

- [ ] **Step 4: Create `whatsapp-send-template-node-form.tsx`**

Create `apps/web-ui/components/agents/config/whatsapp-send-template-node-form.tsx`:

```typescript
'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { WhatsAppSendTemplateNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  templateName: z.string().min(1, 'Template name is required'),
  languageCode: z.string().min(2, 'Language code is required'),
  componentsChannel: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  config: WhatsAppSendTemplateNodeConfig;
  onChange: (config: WhatsAppSendTemplateNodeConfig) => void;
}

export function WhatsAppSendTemplateNodeForm({ config, onChange }: Props) {
  const form = useForm({
    defaultValues: {
      templateName: config.templateName ?? '',
      languageCode: config.languageCode ?? 'en',
      componentsChannel: config.componentsChannel ?? '',
    } as FormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'whatsapp_send_template',
        templateName: value.templateName,
        languageCode: value.languageCode,
        componentsChannel: value.componentsChannel || undefined,
      });
    },
  });

  const handleBlur = () => form.handleSubmit();

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4">
      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Works outside the 24-hour customer service window. Template must be approved in your Meta Business account.
      </div>
      <form.Field name="templateName">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Template Name</Label>
            <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={() => { field.handleBlur(); handleBlur(); }} placeholder="hello_world" />
            <p className="text-[10px] text-muted-foreground">Exact name of the approved Meta template</p>
            {field.state.meta.errors.length > 0 && <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>}
          </div>
        )}
      </form.Field>
      <form.Field name="languageCode">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Language Code</Label>
            <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={() => { field.handleBlur(); handleBlur(); }} placeholder="en" />
            <p className="text-[10px] text-muted-foreground">e.g. en, en_US, hi, ar</p>
            {field.state.meta.errors.length > 0 && <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>}
          </div>
        )}
      </form.Field>
      <form.Field name="componentsChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Components Channel</Label>
            <Input id={field.name} value={field.state.value ?? ''} onChange={(e) => field.handleChange(e.target.value)} onBlur={() => { field.handleBlur(); handleBlur(); }} placeholder="optional" />
            <p className="text-[10px] text-muted-foreground">Channel with template variable components as JSON array. Leave blank for templates with no variables.</p>
          </div>
        )}
      </form.Field>
    </form>
  );
}
```

- [ ] **Step 5: Wire forms into `config-panel.tsx`**

Open `apps/web-ui/components/agents/config/config-panel.tsx`. Add imports after the existing `DelayNodeForm` import:

```typescript
import { WhatsAppTriggerNodeForm } from './whatsapp-trigger-node-form';
import { WhatsAppSendNodeForm } from './whatsapp-send-node-form';
import { WhatsAppSendTemplateNodeForm } from './whatsapp-send-template-node-form';
```

Add the three cases inside the `<ScrollArea>` div, after the `delay` case:

```typescript
          {node.config.type === 'whatsapp_trigger' && (
            <WhatsAppTriggerNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'whatsapp_send' && (
            <WhatsAppSendNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'whatsapp_send_template' && (
            <WhatsAppSendTemplateNodeForm config={node.config} onChange={handleChange} />
          )}
```

- [ ] **Step 6: TypeScript check**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json 2>&1 | grep "whatsapp-"
```
Expected: no output (zero errors on the new files).

- [ ] **Step 7: Commit**

```bash
git add libs/agent-studio/src/index.ts \
        apps/web-ui/components/agents/config/whatsapp-trigger-node-form.tsx \
        apps/web-ui/components/agents/config/whatsapp-send-node-form.tsx \
        apps/web-ui/components/agents/config/whatsapp-send-template-node-form.tsx \
        apps/web-ui/components/agents/config/config-panel.tsx
git commit -m "feat(web-ui): add WhatsApp node config forms and wire into canvas config panel"
```

---

## Task 9b: Canvas Node Styling

**Files:**
- Create: `apps/web-ui/components/agents/canvas/nodes/whatsapp-trigger-node.tsx`
- Create: `apps/web-ui/components/agents/canvas/nodes/whatsapp-send-node.tsx`
- Create: `apps/web-ui/components/agents/canvas/nodes/whatsapp-send-template-node.tsx`
- Modify: `apps/web-ui/components/agents/canvas/node-types.ts`
- Modify: `apps/web-ui/components/agents/canvas/node-palette.tsx`

Without dedicated canvas node components, React Flow falls back to its unstyled default renderer
(plain white box with just the node label). This task adds the three styled canvas components and
registers them.

- [x] **Step 1: Create the three canvas node component files** — follow the pattern in `delay-node.tsx`:
  `min-w-[180px] rounded-lg border bg-card shadow-sm` wrapper, `bg-muted/40 rounded-t-lg` header with
  icon + label + badge, content area showing key config fields, React Flow `<Handle>` top/bottom.
  `WhatsAppTriggerNode` has no top handle (entry point). All use `WhatsAppIcon` with `text-green-600`.

- [x] **Step 2: Register in `node-types.ts`** — import and add `whatsapp_trigger`, `whatsapp_send`,
  `whatsapp_send_template` to the `nodeTypes` export.

- [x] **Step 3: Add icons + colors to `node-palette.tsx`** — add `WhatsAppIcon` for all three types
  with `text-green-600` color. Change `NODE_ICONS` type to `Record<string, ElementType>` so the custom
  SVG icon coexists with lucide icons.

---

## Task 10: Push and Verify

- [ ] **Step 1: Push to Bitbucket**

```bash
git push bitbucket omar-updating-graph-agent
```

- [ ] **Step 2: Manual smoke test (requires running environment)**

To verify end-to-end:
1. Configure a graph agent with nodes: `[whatsapp_trigger] → [llm] → [whatsapp_send]`
2. Assign that agent to a `WhatsAppRouting` rule for a connected account
3. Send a WhatsApp message to the connected number
4. Verify the reply arrives on WhatsApp
5. Check server logs for `WhatsApp trigger processed` and `WhatsApp message sent`

---

## Self-Review Checklist

**Spec coverage:**
- [x] `whatsapp_trigger` node — Task 3
- [x] `whatsapp_send` node — Task 4
- [x] `whatsapp_send_template` node — Task 5
- [x] NodeType + NodeConfig union extended — Task 1
- [x] Zod schemas + NodeRegistry definitions — Task 2
- [x] index.ts + server.ts wiring — Task 6
- [x] MessageProcessor context enrichment — Task 7
- [x] MessageProcessor conditional send — Task 7
- [x] executeGraphAgent stub replaced — Task 8
- [x] All tests — Tasks 3–8
- [x] Frontend config forms for all 3 node types — Task 9
- [x] Forms wired into canvas config panel — Task 9
- [x] New config types exported from agent-studio index — Task 9
- [x] Canvas node components styled to match all other nodes — Task 9b
- [x] WhatsApp nodes registered in `nodeTypes` (React Flow) — Task 9b
- [x] Palette icons + colors added for WhatsApp nodes — Task 9b

**No placeholders:** All code blocks are complete and runnable.

**Type consistency:** `WhatsAppTriggerNodeConfig`, `WhatsAppSendNodeConfig`, `WhatsAppSendTemplateNodeConfig` used consistently across types.ts, schema files, executor files, and frontend forms.

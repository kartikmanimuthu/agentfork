# WhatsApp Channels Tab for Simple Agents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Channels tab to the simple agent edit page so users can connect a WhatsApp account directly to the agent, and fix `executeSimpleAgent` so it replies with full KB, MCP, and built-in tool support — identical to the playground.

**Architecture:** Add `agentId` to `WhatsAppAccount` (one-to-one, mirrors `TelegramAccount`). In `message-processor.ts`, short-circuit the routing lookup when `account.agentId` is set. Fix `executeSimpleAgent` to query attached KBs, load MCP + built-in tools, and call `streamChat` with `maxSteps: 5`. Add three API routes under `/api/agents/[id]/channels/whatsapp`. Add a Channels tab component to the simple agent edit page.

**Tech Stack:** Prisma, Next.js 15 App Router, TanStack Query v5, shadcn/ui, Vitest, `@chatbot/ai` (`streamChat`, `buildBuiltInTools`, `createLLMProvider`), `@chatbot/shared` (`LlmProviderService`, `TenantConfigService`), `@chatbot/agent-studio/server` (`buildMcpToolsForAgent`), `@chatbot/knowledge-base` (`RetrievalService`).

## Global Constraints

- Simple agents only — graph agents are excluded from the Channels tab.
- One WhatsApp account connects to at most one agent at a time. POST clears any existing connection on the account first.
- `WhatsAppRouting`, routing rules, `executeGraphAgent`, graph agent edit page, all Telegram code — must not be modified.
- `executeSimpleAgent` fix applies to all simple agent WhatsApp invocations (not just Channels-connected accounts). It is purely additive.
- All new API routes: Zod validation on request bodies, Pino structured logging with `{ tenantId, agentId }` context, try/catch returning typed error responses.
- All new UI: shadcn/ui components only. No raw HTML form elements.
- Run `bunx prisma generate --schema=./prisma/schema.prisma` after schema changes.
- Run `bunx prisma db push` to apply the schema to the local DB.
- Test runner for `libs/whatsapp`: `bunx vitest run --config libs/whatsapp/vitest.config.ts`

---

## File Map

| File | Action | Task |
|---|---|---|
| `prisma/schema.prisma` | Modify | 1 |
| `prisma/migrations/20260627000000_add_whatsapp_account_agent_id/migration.sql` | Create | 1 |
| `libs/whatsapp/src/processor/agent-executor.ts` | Modify | 2 |
| `libs/whatsapp/src/processor/agent-executor.test.ts` | Create | 2 |
| `libs/whatsapp/src/processor/message-processor.ts` | Modify | 3 |
| `libs/whatsapp/src/processor/message-processor.test.ts` | Modify | 3 |
| `apps/web-ui/app/api/agents/[id]/channels/whatsapp/route.ts` | Create | 4 |
| `apps/web-ui/app/api/whatsapp/accounts/route.ts` | Modify | 4 |
| `apps/web-ui/hooks/use-whatsapp-accounts.ts` | Create | 5 |
| `apps/web-ui/hooks/use-agent-whatsapp-channel.ts` | Create | 5 |
| `apps/web-ui/components/agents/tabs/channels-tab.tsx` | Create | 5 |
| `apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx` | Modify | 5 |

---

### Task 1: Schema — Add `agentId` to `WhatsAppAccount`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260627000000_add_whatsapp_account_agent_id/migration.sql`

**Interfaces:**
- Produces: `WhatsAppAccount.agentId: String?` — consumed by Tasks 3 and 4.

- [ ] **Step 1: Add the field to `WhatsAppAccount` in `prisma/schema.prisma`**

Find the `model WhatsAppAccount` block (currently ends at `@@map("whatsapp_accounts")`). Add `agentId`, the relation field, and the index:

```prisma
model WhatsAppAccount {
  id                  String   @id @default(cuid())
  tenantId            String
  provider            String   @default("meta")
  wabaId              String
  phoneNumberId       String   @unique
  displayPhone        String
  displayName         String
  accessToken         String
  webhookSecret       String
  status              String   @default("active")
  qualityRating       String?
  messagingLimit      String?
  restrictToAllowlist Boolean  @default(true)
  agentId             String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  tenant          Tenant                   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  agent           Agent?                   @relation("WhatsAppAccountAgent", fields: [agentId], references: [id], onDelete: SetNull)
  routingConfig   WhatsAppRouting?
  sessions        WhatsAppSession[]
  messages        WhatsAppMessage[]
  templates       WhatsAppTemplate[]
  allowedContacts WhatsAppAllowedContact[]

  @@unique([tenantId, wabaId])
  @@index([tenantId])
  @@index([agentId])
  @@map("whatsapp_accounts")
}
```

- [ ] **Step 2: Add the back-relation to `model Agent` in `prisma/schema.prisma`**

Find the `model Agent` block. Add one line inside the relations section (after `telegramAccounts TelegramAccount[]`):

```prisma
  whatsAppAccounts   WhatsAppAccount[]    @relation("WhatsAppAccountAgent")
```

- [ ] **Step 3: Create the migration file**

Create directory and file:
```
prisma/migrations/20260627000000_add_whatsapp_account_agent_id/migration.sql
```

Contents:
```sql
-- AlterTable
ALTER TABLE "whatsapp_accounts" ADD COLUMN "agentId" TEXT;

-- CreateIndex
CREATE INDEX "whatsapp_accounts_agentId_idx" ON "whatsapp_accounts"("agentId");

-- AddForeignKey
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 4: Regenerate Prisma client and apply to local DB**

```bash
bunx prisma generate --schema=./prisma/schema.prisma
bunx prisma db push
```

Expected: no errors. `whatsapp_accounts.agentId` column now exists in local DB.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260627000000_add_whatsapp_account_agent_id/migration.sql
git commit -m "feat(whatsapp): add agentId to WhatsAppAccount for direct agent binding"
```

---

### Task 2: Fix `executeSimpleAgent` — KB, MCP, and built-in tool support

**Files:**
- Modify: `libs/whatsapp/src/processor/agent-executor.ts`
- Create: `libs/whatsapp/src/processor/agent-executor.test.ts`

**Interfaces:**
- Consumes: `this.prisma.agentKnowledgeBase.findMany`, `buildMcpToolsForAgent(agentId, tenantId, prisma)`, `buildBuiltInTools`, `streamChat`, `createLLMProvider`, `LlmProviderService`, `TenantConfigService` (all from existing package exports).
- Produces: `executeSimpleAgent` now queries KB + loads MCP/built-in tools before calling LLM. Public `execute()` signature unchanged.

- [ ] **Step 1: Write the failing test**

Create `libs/whatsapp/src/processor/agent-executor.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@chatbot/ai', async () => {
  const actual = await vi.importActual('@chatbot/ai');
  return {
    ...actual,
    createLLMProvider: vi.fn(() => ({})),
    streamChat: vi.fn(() => ({ text: Promise.resolve('AI reply') })),
    buildBuiltInTools: vi.fn(async () => ({})),
  };
});

vi.mock('@chatbot/shared', async () => {
  const actual = await vi.importActual('@chatbot/shared');
  return {
    ...actual,
    LlmProviderService: vi.fn(() => ({
      list: vi.fn(async () => []),
      getDefaultConfig: vi.fn(async () => ({ provider: 'bedrock', chatModel: 'claude-3' })),
    })),
    TenantConfigService: vi.fn(() => ({
      get: vi.fn(async () => null),
    })),
  };
});

vi.mock('@chatbot/agent-studio/server', () => ({
  buildMcpToolsForAgent: vi.fn(async () => ({ tools: {}, cleanup: vi.fn(async () => {}) })),
}));

vi.mock('@chatbot/knowledge-base', () => ({
  RetrievalService: vi.fn(() => ({
    query: vi.fn(async () => [{ content: 'KB chunk' }]),
  })),
}));

import { WhatsAppAgentExecutor } from './agent-executor';
import { streamChat, buildBuiltInTools } from '@chatbot/ai';
import { buildMcpToolsForAgent } from '@chatbot/agent-studio/server';

const mockPrisma = {
  agent: { findFirst: vi.fn() },
  agentKnowledgeBase: { findMany: vi.fn() },
};

const noopProviderFactory = vi.fn();

describe('WhatsAppAgentExecutor.executeSimpleAgent', () => {
  let executor: WhatsAppAgentExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new WhatsAppAgentExecutor(mockPrisma as any, noopProviderFactory as any);
  });

  it('returns LLM text for a simple agent', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'agent_1',
      type: 'simple',
      config: { model: 'claude-3', systemPrompt: 'You are helpful.', temperature: 0.7 },
    });
    mockPrisma.agentKnowledgeBase.findMany.mockResolvedValueOnce([]);

    const result = await executor.execute('agent_1', { text: 'Hello' }, { tenantId: 'tenant_1' });

    expect(result.text).toBe('AI reply');
    expect(streamChat).toHaveBeenCalledOnce();
  });

  it('injects KB context into the system prompt when KB is attached', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'agent_1',
      type: 'simple',
      config: { model: 'claude-3', systemPrompt: 'You are helpful.', temperature: 0.7 },
    });
    mockPrisma.agentKnowledgeBase.findMany.mockResolvedValueOnce([
      { knowledgeBase: { id: 'kb_1', name: 'Docs', status: 'active' } },
    ]);

    await executor.execute('agent_1', { text: 'What is X?' }, { tenantId: 'tenant_1' });

    const callArgs = vi.mocked(streamChat).mock.calls[0][0] as any;
    expect(callArgs.system).toContain('retrieved context');
    expect(callArgs.system).toContain('KB chunk');
  });

  it('passes MCP tools to streamChat when tools are available', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'agent_1',
      type: 'simple',
      config: { model: 'claude-3', systemPrompt: 'You are helpful.' },
    });
    mockPrisma.agentKnowledgeBase.findMany.mockResolvedValueOnce([]);
    vi.mocked(buildMcpToolsForAgent).mockResolvedValueOnce({
      tools: { myTool: { description: 'A tool', parameters: {}, execute: vi.fn() } } as any,
      cleanup: vi.fn(async () => {}),
    });

    await executor.execute('agent_1', { text: 'Use the tool' }, { tenantId: 'tenant_1' });

    const callArgs = vi.mocked(streamChat).mock.calls[0][0] as any;
    expect(callArgs.tools).toBeDefined();
    expect(callArgs.maxSteps).toBe(5);
  });

  it('calls streamChat without tools when none are attached', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'agent_1',
      type: 'simple',
      config: { model: 'claude-3', systemPrompt: 'You are helpful.' },
    });
    mockPrisma.agentKnowledgeBase.findMany.mockResolvedValueOnce([]);
    vi.mocked(buildMcpToolsForAgent).mockResolvedValueOnce({ tools: {}, cleanup: vi.fn(async () => {}) });
    vi.mocked(buildBuiltInTools).mockResolvedValueOnce({});

    await executor.execute('agent_1', { text: 'Hi' }, { tenantId: 'tenant_1' });

    const callArgs = vi.mocked(streamChat).mock.calls[0][0] as any;
    expect(callArgs.tools).toBeUndefined();
    expect(callArgs.maxSteps).toBeUndefined();
  });

  it('throws for unknown agent type', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce({ id: 'agent_1', type: 'unknown', config: {} });

    await expect(executor.execute('agent_1', { text: 'Hi' }, { tenantId: 'tenant_1' }))
      .rejects.toThrow('Unsupported agent type: unknown');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bunx vitest run --config libs/whatsapp/vitest.config.ts libs/whatsapp/src/processor/agent-executor.test.ts
```

Expected: FAIL — `streamChat` mock not yet called from `executeSimpleAgent`.

- [ ] **Step 3: Rewrite `agent-executor.ts`**

Replace the entire file with:

```ts
import type { PrismaClient } from '@prisma/client';
import { createLLMProvider, streamChat, buildBuiltInTools } from '@chatbot/ai';
import { LlmProviderService, TenantConfigService } from '@chatbot/shared';
import type { AgentExecutor } from './message-processor';

export type LlmProviderFactory = (config: { model: string; temperature?: number; tenantId: string }) => {
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
    const tenantId = (context.tenantId as string) ?? '';

    // Resolve LLM provider
    const llmConfig = await this.resolveLlmConfig(tenantId, config.model);
    const llmProvider = createLLMProvider(llmConfig);

    // Build conversation history
    const history = (context.messages as Array<{ role: string; content: string }>) ?? [];
    const userMessage = message.text ?? '';

    // Query KB → inject context into system prompt
    const kbContext = await this.buildKbContext(agent.id, tenantId, userMessage);
    let effectiveSystem = config.systemPrompt;
    if (kbContext) {
      effectiveSystem = `${effectiveSystem}\n\nUse the following retrieved context to answer questions. If the context does not contain the answer, say so.\n\n${kbContext}`;
    }

    // Load MCP + built-in tools
    const { buildMcpToolsForAgent } = await import('@chatbot/agent-studio/server');
    const { tools: mcpTools, cleanup: mcpCleanup } = await buildMcpToolsForAgent(agent.id, tenantId, this.prisma);
    const tenantConfigService = new TenantConfigService(tenantId);
    const builtInTools = await buildBuiltInTools(tenantId, {
      configResolver: { get: (key: string) => tenantConfigService.get(key) },
    });
    const allTools = { ...mcpTools, ...builtInTools };
    const hasTools = Object.keys(allTools).length > 0;

    // Build message array
    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
      ...history.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
    ];
    if (userMessage) {
      messages.push({ role: 'user' as const, content: userMessage });
    }

    try {
      const result = streamChat({
        provider: llmProvider,
        messages,
        system: effectiveSystem,
        model: config.model,
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
        ...(hasTools ? { tools: allTools, maxSteps: 5 } : {}),
      });
      const text = await result.text;
      return { text };
    } finally {
      await mcpCleanup();
    }
  }

  private async resolveLlmConfig(tenantId: string, modelId?: string) {
    if (!tenantId) return null;
    const llmProviderService = new LlmProviderService(tenantId);
    if (modelId) {
      const providers = await llmProviderService.list();
      for (const p of providers) {
        const models = (p.models as { models?: Array<{ id: string }> } | null)?.models ?? [];
        if (models.some((m: { id: string }) => m.id === modelId)) {
          return llmProviderService.getConfigById(p.id);
        }
      }
    }
    return (await llmProviderService.getDefaultConfig()) ?? (await new TenantConfigService(tenantId).get('llmConfig'));
  }

  private async buildKbContext(agentId: string, tenantId: string, query: string): Promise<string> {
    if (!query) return '';
    try {
      const attachments = await (this.prisma as any).agentKnowledgeBase.findMany({
        where: { agentId },
        include: { knowledgeBase: true },
      });
      if (!attachments?.length) return '';
      const { RetrievalService } = await import('@chatbot/knowledge-base');
      const retrieval = new RetrievalService(tenantId);
      const contexts: string[] = [];
      for (const att of attachments) {
        const kb = att.knowledgeBase;
        if (kb.status !== 'active') continue;
        try {
          const results = await retrieval.query(query, { knowledgeBaseId: kb.id, topK: 5 });
          if (results.length > 0) {
            contexts.push(`--- From ${kb.name} ---\n${results.map((r: any) => r.content).join('\n\n')}`);
          }
        } catch {
          // skip failing KBs
        }
      }
      return contexts.join('\n\n');
    } catch {
      return '';
    }
  }

  private async executeGraphAgent(
    agent: { id: string; config: any },
    message: { text?: string; mediaId?: string; mediaType?: string },
    context: Record<string, unknown>,
  ): Promise<{ text: string }> {
    // @ts-ignore — dynamic import to avoid circular dependency at build time
    const { GraphExecutor, createNodeExecutors } = await import('@chatbot/agent-studio/server');

    const graphDef = agent.config as { nodes: any[]; edges: any[] };

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
      messages: [
        ...((context['messages'] as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>) ?? []),
        ...(message.text ? [{ role: 'user' as const, content: message.text }] : []),
      ],
      currentNodeId: entryNode.id as string,
      metadata: {
        executionId: crypto.randomUUID(),
        agentId: agent.id,
        tenantId: (context['tenantId'] as string) ?? '',
        userId: 'whatsapp',
        startedAt: new Date(),
      },
    };

    const tenantId = (context['tenantId'] as string) ?? '';
    const executor = new GraphExecutor({
      llmProvider: async (_providerId?: string, modelId?: string) => {
        const llmConfig = await this.resolveLlmConfig(tenantId, modelId);
        return createLLMProvider(llmConfig);
      },
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

    if (finalState.channels['wa_last_sent_message_id']) {
      return { text: '' };
    }

    const responseText =
      String(finalState.channels['response'] ?? finalState.channels['llm_output'] ?? '');

    return { text: responseText };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bunx vitest run --config libs/whatsapp/vitest.config.ts libs/whatsapp/src/processor/agent-executor.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Run all whatsapp tests to check no regressions**

```bash
bunx vitest run --config libs/whatsapp/vitest.config.ts
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add libs/whatsapp/src/processor/agent-executor.ts libs/whatsapp/src/processor/agent-executor.test.ts
git commit -m "feat(whatsapp): add KB, MCP, and built-in tool support to executeSimpleAgent"
```

---

### Task 3: Processor short-circuit for `account.agentId`

**Files:**
- Modify: `libs/whatsapp/src/processor/message-processor.ts` (lines 82–119)
- Modify: `libs/whatsapp/src/processor/message-processor.test.ts`

**Interfaces:**
- Consumes: `account.agentId` from Task 1 (available on the account object returned by Prisma).
- Produces: when `account.agentId` is set, `sessionManager.createSession` is called with that agentId directly, skipping `whatsAppRouting` lookup entirely.

- [ ] **Step 1: Write the failing test**

Open `libs/whatsapp/src/processor/message-processor.test.ts`. Add this test inside the existing `describe('MessageProcessor')` block:

```ts
it('uses account.agentId directly without routing when set', async () => {
  mockPrisma.whatsAppAccount.findFirst.mockResolvedValueOnce({
    id: 'acc_1',
    tenantId: 'tenant_1',
    accessToken: 'token',
    phoneNumberId: 'PH1',
    provider: 'netcore',
    restrictToAllowlist: false,
    agentId: 'agent_direct',
  });
  mockPrisma.whatsAppMessage.findUnique.mockResolvedValueOnce(null);
  mockPrisma.whatsAppMessage.create.mockResolvedValueOnce({});
  mockContactLock.acquire.mockResolvedValueOnce(true);
  mockCircuitBreaker.isOpen.mockReturnValueOnce(false);
  mockSessionManager.findActiveSession.mockResolvedValueOnce(null);
  mockSessionManager.createSession.mockResolvedValueOnce({
    id: 'session_1',
    agentId: 'agent_direct',
    lastMessageAt: null,
    context: {},
  });
  mockAgentExecutor.execute.mockResolvedValueOnce({ text: 'Hello!' });
  mockMetaClient.sendTextMessage.mockResolvedValueOnce({ messages: [{ id: 'out_1' }] });

  await processor.processMessageEvent({
    type: 'message',
    phoneNumberId: 'PH1',
    contact: { profile: { name: 'Omar' }, wa_id: '919876543210' },
    message: { from: '919876543210', id: 'wamid.1', timestamp: '1', type: 'text', text: { body: 'Hi' } },
  });

  expect(mockSessionManager.createSession).toHaveBeenCalledWith(
    expect.objectContaining({ agentId: 'agent_direct' }),
  );
  expect(mockPrisma.whatsAppRouting.findUnique).not.toHaveBeenCalled();
  expect(mockAgentExecutor.execute).toHaveBeenCalledWith(
    'agent_direct',
    expect.anything(),
    expect.anything(),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bunx vitest run --config libs/whatsapp/vitest.config.ts libs/whatsapp/src/processor/message-processor.test.ts
```

Expected: FAIL — routing lookup is still called even when `agentId` is set.

- [ ] **Step 3: Add the short-circuit branch in `message-processor.ts`**

Find the block starting at `let session = await this.deps.sessionManager.findActiveSession(...)` (around line 82). Replace the `if (!session)` block with:

```ts
let session = await this.deps.sessionManager.findActiveSession(account.id, contact.wa_id);

if (!session) {
  if (account.agentId) {
    session = await this.deps.sessionManager.createSession({
      accountId: account.id,
      contactPhone: contact.wa_id,
      contactName: contact.profile.name,
      agentId: account.agentId,
    });
  } else {
    const routing = await (this.deps.prisma as any).whatsAppRouting.findUnique({
      where: { accountId: account.id },
    });

    if (!routing) return;

    const rules = await (this.deps.prisma as any).whatsAppRoutingRule.findMany({
      where: { routingId: routing.id, isActive: true },
      orderBy: { priority: 'asc' },
    });

    const router = createRouter(routing.strategy);
    const routingResult = await router.route({
      message,
      contactPhone: contact.wa_id,
      contactName: contact.profile.name,
      accountId: account.id,
      routing: { strategy: routing.strategy, config: routing.config, fallbackAgentId: routing.fallbackAgentId },
      rules,
    });

    if (routingResult.type === 'prompt') {
      const metaClient = this.deps.clientFactory(account);
      await metaClient.sendInteractiveMessage(contact.wa_id, routingResult.interactiveMessage);
      return;
    }

    const agentId = routingResult.agentId;
    session = await this.deps.sessionManager.createSession({
      accountId: account.id,
      contactPhone: contact.wa_id,
      contactName: contact.profile.name,
      agentId,
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bunx vitest run --config libs/whatsapp/vitest.config.ts libs/whatsapp/src/processor/message-processor.test.ts
```

Expected: all tests pass including the new one.

- [ ] **Step 5: Commit**

```bash
git add libs/whatsapp/src/processor/message-processor.ts libs/whatsapp/src/processor/message-processor.test.ts
git commit -m "feat(whatsapp): short-circuit routing when account has direct agentId binding"
```

---

### Task 4: API routes — connect/disconnect WhatsApp channel

**Files:**
- Create: `apps/web-ui/app/api/agents/[id]/channels/whatsapp/route.ts`
- Modify: `apps/web-ui/app/api/whatsapp/accounts/route.ts`

**Interfaces:**
- Consumes: `WhatsAppAccount.agentId` from Task 1.
- Produces:
  - `GET /api/agents/[id]/channels/whatsapp` → `{ account: { id, displayName, displayPhone, provider } | null }`
  - `POST /api/agents/[id]/channels/whatsapp` body `{ accountId: string }` → `{ account: { id, displayName, displayPhone, provider } }`
  - `DELETE /api/agents/[id]/channels/whatsapp` → `{ ok: true }`
  - `GET /api/whatsapp/accounts` response now includes `agentId: string | null`

- [ ] **Step 1: Create the channels API route**

Create file `apps/web-ui/app/api/agents/[id]/channels/whatsapp/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('api:agent-channels-whatsapp');

const connectSchema = z.object({
  accountId: z.string().min(1),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Agent', authOptions);
    if (authError) return authError;

    const { id: agentId } = await params;
    const prisma = getPrismaClient();

    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { tenantId, agentId },
      select: { id: true, displayName: true, displayPhone: true, provider: true },
    });

    logger.info({ tenantId, agentId }, 'Fetched WhatsApp channel binding');
    return NextResponse.json({ account: account ?? null });
  } catch (error) {
    logger.error({ error }, 'Error fetching WhatsApp channel binding');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id: agentId } = await params;
    const body = await req.json();
    const parsed = connectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const prisma = getPrismaClient();

    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id: parsed.data.accountId, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Clear any existing binding for this agent (one-to-one enforcement)
    await (prisma as any).whatsAppAccount.updateMany({
      where: { tenantId, agentId },
      data: { agentId: null },
    });

    // Set the new binding
    const updated = await (prisma as any).whatsAppAccount.update({
      where: { id: parsed.data.accountId },
      data: { agentId },
      select: { id: true, displayName: true, displayPhone: true, provider: true },
    });

    logger.info({ tenantId, agentId, accountId: parsed.data.accountId }, 'WhatsApp channel connected');
    return NextResponse.json({ account: updated });
  } catch (error) {
    logger.error({ error }, 'Error connecting WhatsApp channel');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Agent', authOptions);
    if (authError) return authError;

    const { id: agentId } = await params;
    const prisma = getPrismaClient();

    await (prisma as any).whatsAppAccount.updateMany({
      where: { tenantId, agentId },
      data: { agentId: null },
    });

    logger.info({ tenantId, agentId }, 'WhatsApp channel disconnected');
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ error }, 'Error disconnecting WhatsApp channel');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add `agentId` to the accounts GET select**

Open `apps/web-ui/app/api/whatsapp/accounts/route.ts`. In the `select` block of `whatsAppAccount.findMany`, add `agentId: true`:

```ts
select: {
  id: true,
  agentId: true,
  provider: true,
  phoneNumberId: true,
  displayPhone: true,
  displayName: true,
  status: true,
  qualityRating: true,
  messagingLimit: true,
  createdAt: true,
},
```

- [ ] **Step 3: Verify routes are reachable (manual)**

Start the dev server (`bun run dev`) and run:

```bash
# Should return { account: null } for an agent with no connection
curl -s -H "Cookie: <your-session-cookie>" \
  http://localhost:3005/api/agents/<some-agent-id>/channels/whatsapp | jq .
```

Expected: `{ "account": null }` with HTTP 200.

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/app/api/agents/\[id\]/channels/whatsapp/route.ts apps/web-ui/app/api/whatsapp/accounts/route.ts
git commit -m "feat(web-ui): add WhatsApp channel connect/disconnect API for agents"
```

---

### Task 5: UI — Channels tab

**Files:**
- Create: `apps/web-ui/hooks/use-whatsapp-accounts.ts`
- Create: `apps/web-ui/hooks/use-agent-whatsapp-channel.ts`
- Create: `apps/web-ui/components/agents/tabs/channels-tab.tsx`
- Modify: `apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: all three API routes from Task 4.
- Produces: Channels tab visible in simple agent edit page between Tools and Versions tabs.

- [ ] **Step 1: Create `use-whatsapp-accounts.ts`**

Create `apps/web-ui/hooks/use-whatsapp-accounts.ts`:

```ts
import { useQuery } from '@tanstack/react-query';

export interface WhatsAppAccountSummary {
  id: string;
  agentId: string | null;
  provider: string;
  displayPhone: string;
  displayName: string;
  status: string;
}

async function fetchWhatsAppAccounts(): Promise<WhatsAppAccountSummary[]> {
  const res = await fetch('/api/whatsapp/accounts');
  if (!res.ok) throw new Error('Failed to fetch WhatsApp accounts');
  return res.json();
}

export const whatsAppAccountKeys = {
  all: ['whatsapp-accounts'] as const,
  lists: () => [...whatsAppAccountKeys.all, 'list'] as const,
};

export function useWhatsAppAccounts() {
  return useQuery({ queryKey: whatsAppAccountKeys.lists(), queryFn: fetchWhatsAppAccounts });
}
```

- [ ] **Step 2: Create `use-agent-whatsapp-channel.ts`**

Create `apps/web-ui/hooks/use-agent-whatsapp-channel.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { whatsAppAccountKeys } from './use-whatsapp-accounts';

interface ConnectedAccount {
  id: string;
  displayName: string;
  displayPhone: string;
  provider: string;
}

async function fetchChannel(agentId: string): Promise<{ account: ConnectedAccount | null }> {
  const res = await fetch(`/api/agents/${agentId}/channels/whatsapp`);
  if (!res.ok) throw new Error('Failed to fetch channel binding');
  return res.json();
}

async function connectChannel(agentId: string, accountId: string): Promise<{ account: ConnectedAccount }> {
  const res = await fetch(`/api/agents/${agentId}/channels/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to connect channel');
  }
  return res.json();
}

async function disconnectChannel(agentId: string): Promise<void> {
  const res = await fetch(`/api/agents/${agentId}/channels/whatsapp`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to disconnect channel');
}

export const agentChannelKeys = {
  whatsapp: (agentId: string) => ['agents', agentId, 'channels', 'whatsapp'] as const,
};

export function useAgentWhatsAppChannel(agentId: string) {
  return useQuery({
    queryKey: agentChannelKeys.whatsapp(agentId),
    queryFn: () => fetchChannel(agentId),
    enabled: Boolean(agentId),
  });
}

export function useConnectWhatsAppChannel(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => connectChannel(agentId, accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentChannelKeys.whatsapp(agentId) });
      queryClient.invalidateQueries({ queryKey: whatsAppAccountKeys.all });
    },
  });
}

export function useDisconnectWhatsAppChannel(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectChannel(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentChannelKeys.whatsapp(agentId) });
      queryClient.invalidateQueries({ queryKey: whatsAppAccountKeys.all });
    },
  });
}
```

- [ ] **Step 3: Create `channels-tab.tsx`**

Create `apps/web-ui/components/agents/tabs/channels-tab.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { CheckCircle2, Link2, Unlink } from 'lucide-react';
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';
import { useWhatsAppAccounts } from '@/hooks/use-whatsapp-accounts';
import {
  useAgentWhatsAppChannel,
  useConnectWhatsAppChannel,
  useDisconnectWhatsAppChannel,
} from '@/hooks/use-agent-whatsapp-channel';

interface ChannelsTabProps {
  agentId: string;
}

export function ChannelsTab({ agentId }: ChannelsTabProps) {
  const { data: channelData, isLoading: channelLoading } = useAgentWhatsAppChannel(agentId);
  const { data: accounts, isLoading: accountsLoading } = useWhatsAppAccounts();
  const connect = useConnectWhatsAppChannel(agentId);
  const disconnect = useDisconnectWhatsAppChannel(agentId);

  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  const connectedAccount = channelData?.account ?? null;

  const availableAccounts = (accounts ?? []).filter(
    (a) => a.agentId === null || a.agentId === agentId,
  );

  const isLoading = channelLoading || accountsLoading;

  const handleConnect = async () => {
    if (!selectedAccountId) return;
    try {
      await connect.mutateAsync(selectedAccountId);
      setSelectedAccountId('');
      toast.success('WhatsApp account connected');
    } catch {
      toast.error('Failed to connect account');
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      setShowDisconnectDialog(false);
      toast.success('WhatsApp account disconnected');
    } catch {
      toast.error('Failed to disconnect account');
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 space-y-3">
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10 text-green-600">
              <WhatsAppIcon className="h-4 w-4" />
            </div>
            <div>
              <CardTitle>WhatsApp</CardTitle>
              <CardDescription>
                Connect a WhatsApp account so this agent replies to messages on that number.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {connectedAccount ? (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <div>
                  <p className="font-medium text-sm">{connectedAccount.displayName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-muted-foreground">{connectedAccount.displayPhone}</p>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {connectedAccount.provider}
                    </Badge>
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDisconnectDialog(true)}
                disabled={disconnect.isPending}
              >
                <Unlink className="h-3 w-3 mr-1" />
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {availableAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No WhatsApp accounts available. Connect one first in{' '}
                  <a href="/settings/channels/whatsapp" className="underline">
                    Settings → Channels → WhatsApp
                  </a>
                  .
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select a WhatsApp account" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.displayName}
                            <span className="ml-1 text-xs text-muted-foreground">
                              {account.displayPhone}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={handleConnect}
                      disabled={!selectedAccountId || connect.isPending}
                    >
                      <Link2 className="h-4 w-4 mr-1" />
                      Connect
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Accounts already connected to another agent are hidden.
                  </p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect WhatsApp account?</AlertDialogTitle>
            <AlertDialogDescription>
              This agent will stop receiving messages from{' '}
              <strong>{connectedAccount?.displayPhone}</strong>. The WhatsApp account itself
              will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDisconnect}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 4: Wire the Channels tab into the simple agent edit page**

Open `apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx`.

Add the import at the top (with the other tab imports):
```ts
import { ChannelsTab } from '@/components/agents/tabs/channels-tab';
```

In the `<TabsList>` for the simple agent section, add between Tools and Versions:
```tsx
<TabsTrigger value="channels">Channels</TabsTrigger>
```

In the `<Tabs>` body, add between the tools and versions `<TabsContent>` blocks:
```tsx
<TabsContent value="channels">
  <ChannelsTab agentId={agentId} />
</TabsContent>
```

- [ ] **Step 5: Verify in the browser**

Start the dev server:
```bash
bun run dev
```

Navigate to `http://localhost:3005/agents/<any-simple-agent-id>/edit`.

Check:
- "Channels" tab appears between Tools and Versions.
- Not-connected state shows the account dropdown.
- Selecting an account and clicking Connect shows the connected state with the account name and phone.
- Clicking Disconnect shows the confirmation dialog, and after confirming returns to the not-connected state.
- Accounts already connected to another agent do not appear in the dropdown.

- [ ] **Step 6: Commit**

```bash
git add \
  apps/web-ui/hooks/use-whatsapp-accounts.ts \
  apps/web-ui/hooks/use-agent-whatsapp-channel.ts \
  apps/web-ui/components/agents/tabs/channels-tab.tsx \
  "apps/web-ui/app/(dashboard)/agents/[id]/edit/page.tsx"
git commit -m "feat(web-ui): add Channels tab to simple agent with WhatsApp account binding"
```

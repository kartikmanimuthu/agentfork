# LLM Provider Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant-configurable LLM provider abstraction to `libs/ai` with Bedrock as the default and OpenAI-compatible provider support (Ollama, vLLM), then wire it through API routes, workers, and the Organization Settings UI.

**Architecture:** Introduce an `LLMProvider` interface in `libs/ai` with two implementations (`BedrockLLMProvider`, `OpenAICompatibleProvider`) and a factory. Tenant config drives provider selection. Chat inference uses the tenant's provider. Message embeddings remain on the global Bedrock default for this iteration to avoid a Prisma migration.

**Tech Stack:** Bun, TypeScript, Next.js 15, Vercel AI SDK (`@ai-sdk/amazon-bedrock`, `@ai-sdk/openai`), Prisma, pgvector, React, TanStack Form, Zod.

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `libs/ai/src/types.ts` | `TenantLLMConfig`, `ProviderName`, `LLMProviderConfig` types |
| `libs/ai/src/provider.ts` | `LLMProvider` interface |
| `libs/ai/src/providers/bedrock.ts` | `BedrockLLMProvider` — wraps `@ai-sdk/amazon-bedrock` |
| `libs/ai/src/providers/openai-compatible.ts` | `OpenAICompatibleProvider` — wraps `@ai-sdk/openai` with `baseURL` |
| `libs/ai/src/provider-factory.ts` | `createLLMProvider(config)` factory function |

### Modified Files

| File | Responsibility |
|---|---|
| `libs/ai/src/chat-completion.ts` | Accept `provider` in `StreamChatOptions`; delegate to `provider.streamChat(...)` |
| `libs/ai/src/embeddings.ts` | Accept `provider` in options; delegate to `provider.embed` / `provider.embedBatch` |
| `libs/ai/src/index.ts` | Export new public API |
| `apps/web-ui/app/api/chat/route.ts` | Read tenant `llmConfig`, instantiate provider, pass to `streamChat` |
| `apps/web-ui/app/api/agents/[id]/playground/route.ts` | Same pattern |
| `apps/web-ui/app/api/tenants/settings/route.ts` | Add `llmConfig` to GET/PUT schema and responses |
| `apps/workers/src/jobs/conversation-summary/handler.ts` | Use factory + provider |
| `apps/web-ui/app/(dashboard)/settings/organization/page.tsx` | Add LLM provider selector, model inputs, base URL field |

### Unchanged

- `prisma/schema.prisma` — no migration needed
- `libs/knowledge-base/**` — KB embeddings remain independent
- `apps/workers/src/jobs/message-embedding/handler.ts` — remains hardcoded Bedrock

---

## Defaults

```typescript
const DEFAULT_LLM_CONFIG: TenantLLMConfig = {
  provider: 'bedrock',
  chatModel: 'anthropic.claude-sonnet-4-20250514',
  embeddingModel: 'amazon.titan-embed-text-v2:0',
  embeddingDimensions: 1024,
};

const OPENAI_DEFAULTS = {
  chatModel: 'gpt-4o',
  embeddingModel: 'text-embedding-3-large',
  embeddingDimensions: 3072,
};
```

---

## Task 1: Add Types and Provider Interface

**Files:**
- Create: `libs/ai/src/types.ts`
- Create: `libs/ai/src/provider.ts`

- [ ] **Step 1: Write `libs/ai/src/types.ts`**

```typescript
export type ProviderName = 'bedrock' | 'openai';

export interface TenantLLMConfig {
  provider: ProviderName;
  chatModel?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  baseUrl?: string;
  apiKey?: string;
}

export const DEFAULT_BEDROCK_CHAT_MODEL = 'anthropic.claude-sonnet-4-20250514';
export const DEFAULT_BEDROCK_EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';
export const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4o';
export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large';

export function getDefaultLLMConfig(provider: ProviderName = 'bedrock'): TenantLLMConfig {
  if (provider === 'openai') {
    return {
      provider: 'openai',
      chatModel: DEFAULT_OPENAI_CHAT_MODEL,
      embeddingModel: DEFAULT_OPENAI_EMBEDDING_MODEL,
      embeddingDimensions: 3072,
    };
  }
  return {
    provider: 'bedrock',
    chatModel: DEFAULT_BEDROCK_CHAT_MODEL,
    embeddingModel: DEFAULT_BEDROCK_EMBEDDING_MODEL,
    embeddingDimensions: 1024,
  };
}
```

- [ ] **Step 2: Write `libs/ai/src/provider.ts`**

```typescript
import type { ModelMessage, LanguageModelUsage } from 'ai';

export interface StreamChatOptions {
  messages: ModelMessage[];
  model?: string;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  onFinish?: (result: { text: string; usage: LanguageModelUsage }) => void | Promise<void>;
}

export interface LLMProvider {
  readonly name: string;
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;

  streamChat(options: StreamChatOptions): ReturnType<typeof import('ai').streamText>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

Note: `streamChat` returns `ReturnType<typeof streamText>` so callers can still use `.toUIMessageStreamResponse()`, `.textStream`, etc.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/apple/.superset/worktrees/chatbot/playground && bunx tsc --noEmit -p libs/ai/tsconfig.json`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add libs/ai/src/types.ts libs/ai/src/provider.ts
git commit -m "feat(ai): add LLMProvider interface and tenant config types"
```

---

## Task 2: Implement BedrockLLMProvider

**Files:**
- Create: `libs/ai/src/providers/bedrock.ts`

- [ ] **Step 1: Create `libs/ai/src/providers/` directory**

```bash
mkdir -p /Users/apple/.superset/worktrees/chatbot/playground/libs/ai/src/providers
```

- [ ] **Step 2: Write `libs/ai/src/providers/bedrock.ts`**

```typescript
import { streamText, embed, embedMany } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import type { LLMProvider, StreamChatOptions } from '../provider';
import type { TenantLLMConfig } from '../types';
import { env } from '../env';

export class BedrockLLMProvider implements LLMProvider {
  readonly name = 'bedrock';
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;

  private readonly client = createAmazonBedrock({ region: env.AWS_REGION });

  constructor(config: TenantLLMConfig) {
    this.chatModel = config.chatModel ?? 'anthropic.claude-sonnet-4-20250514';
    this.embeddingModel = config.embeddingModel ?? 'amazon.titan-embed-text-v2:0';
    this.embeddingDimensions = config.embeddingDimensions ?? 1024;
  }

  streamChat(options: StreamChatOptions) {
    const { messages, model, system, temperature = 0.7, maxOutputTokens = 4096, onFinish } = options;
    return streamText({
      model: this.client(model ?? this.chatModel),
      messages,
      system,
      temperature,
      maxOutputTokens,
      onFinish,
    });
  }

  async embed(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: this.client.textEmbeddingModel(this.embeddingModel),
      value: text,
    });
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const { embeddings } = await embedMany({
      model: this.client.textEmbeddingModel(this.embeddingModel),
      values: texts,
    });
    return embeddings;
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/apple/.superset/worktrees/chatbot/playground && bunx tsc --noEmit -p libs/ai/tsconfig.json`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add libs/ai/src/providers/bedrock.ts
git commit -m "feat(ai): add BedrockLLMProvider implementation"
```

---

## Task 3: Implement OpenAICompatibleProvider

**Files:**
- Create: `libs/ai/src/providers/openai-compatible.ts`

- [ ] **Step 1: Write `libs/ai/src/providers/openai-compatible.ts`**

```typescript
import { streamText, embed, embedMany } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { LLMProvider, StreamChatOptions } from '../provider';
import type { TenantLLMConfig } from '../types';

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = 'openai';
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;

  private readonly client: ReturnType<typeof createOpenAI>;

  constructor(config: TenantLLMConfig) {
    if (!config.baseUrl) {
      throw new Error('OpenAI-compatible provider requires baseUrl');
    }
    this.chatModel = config.chatModel ?? 'gpt-4o';
    this.embeddingModel = config.embeddingModel ?? 'text-embedding-3-large';
    this.embeddingDimensions = config.embeddingDimensions ?? 3072;

    this.client = createOpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    });
  }

  streamChat(options: StreamChatOptions) {
    const { messages, model, system, temperature = 0.7, maxOutputTokens = 4096, onFinish } = options;
    return streamText({
      model: this.client(model ?? this.chatModel),
      messages,
      system,
      temperature,
      maxOutputTokens,
      onFinish,
    });
  }

  async embed(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: this.client.textEmbeddingModel(this.embeddingModel),
      value: text,
    });
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const { embeddings } = await embedMany({
      model: this.client.textEmbeddingModel(this.embeddingModel),
      values: texts,
    });
    return embeddings;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/apple/.superset/worktrees/chatbot/playground && bunx tsc --noEmit -p libs/ai/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add libs/ai/src/providers/openai-compatible.ts
git commit -m "feat(ai): add OpenAICompatibleProvider implementation"
```

---

## Task 4: Add Provider Factory

**Files:**
- Create: `libs/ai/src/provider-factory.ts`

- [ ] **Step 1: Write `libs/ai/src/provider-factory.ts`**

```typescript
import type { LLMProvider } from './provider';
import type { TenantLLMConfig } from './types';
import { getDefaultLLMConfig } from './types';
import { BedrockLLMProvider } from './providers/bedrock';
import { OpenAICompatibleProvider } from './providers/openai-compatible';

export function createLLMProvider(config?: TenantLLMConfig | null): LLMProvider {
  const effectiveConfig = config ?? getDefaultLLMConfig('bedrock');

  switch (effectiveConfig.provider) {
    case 'bedrock':
      return new BedrockLLMProvider(effectiveConfig);
    case 'openai':
      return new OpenAICompatibleProvider(effectiveConfig);
    default:
      throw new Error(`Unknown LLM provider: ${(effectiveConfig as any).provider}`);
  }
}

export function getDefaultProvider(): LLMProvider {
  return new BedrockLLMProvider(getDefaultLLMConfig('bedrock'));
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/apple/.superset/worktrees/chatbot/playground && bunx tsc --noEmit -p libs/ai/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add libs/ai/src/provider-factory.ts
git commit -m "feat(ai): add LLM provider factory"
```

---

## Task 5: Refactor `chat-completion.ts` to Use Provider

**Files:**
- Modify: `libs/ai/src/chat-completion.ts`

- [ ] **Step 1: Rewrite `libs/ai/src/chat-completion.ts`**

```typescript
import type { ModelMessage, LanguageModelUsage } from 'ai';
import type { LLMProvider } from './provider';

export interface StreamChatOptions {
  provider: LLMProvider;
  messages: ModelMessage[];
  model?: string;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  onFinish?: (result: { text: string; usage: LanguageModelUsage }) => void | Promise<void>;
}

export function streamChat(options: StreamChatOptions) {
  return options.provider.streamChat(options);
}
```

Note: `streamChat` now requires `provider` in options and delegates entirely. The old `getBedrockProvider()` and `DEFAULT_MODEL` imports are removed from this file.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/apple/.superset/worktrees/chatbot/playground && bunx tsc --noEmit -p libs/ai/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Update test file if it exists**

Check: `libs/ai/src/chat-completion.test.ts`. If it exists, update mocks to pass a fake `LLMProvider` with a `streamChat` method.

- [ ] **Step 4: Commit**

```bash
git add libs/ai/src/chat-completion.ts
git commit -m "refactor(ai): delegate chat-completion to LLMProvider"
```

---

## Task 6: Refactor `embeddings.ts` to Use Provider

**Files:**
- Modify: `libs/ai/src/embeddings.ts`

- [ ] **Step 1: Rewrite `libs/ai/src/embeddings.ts`**

```typescript
import type { LLMProvider } from './provider';

export async function generateEmbedding(text: string, provider: LLMProvider): Promise<number[]> {
  return provider.embed(text);
}

export async function generateEmbeddings(texts: string[], provider: LLMProvider): Promise<number[][]> {
  return provider.embedBatch(texts);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/apple/.superset/worktrees/chatbot/playground && bunx tsc --noEmit -p libs/ai/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add libs/ai/src/embeddings.ts
git commit -m "refactor(ai): delegate embeddings to LLMProvider"
```

---

## Task 7: Update `libs/ai/src/index.ts` Exports

**Files:**
- Modify: `libs/ai/src/index.ts`

- [ ] **Step 1: Rewrite `libs/ai/src/index.ts`**

```typescript
export { createLLMProvider, getDefaultProvider } from './provider-factory';
export { streamChat, type StreamChatOptions } from './chat-completion';
export { generateEmbedding, generateEmbeddings } from './embeddings';
export type { LLMProvider } from './provider';
export type { TenantLLMConfig, ProviderName } from './types';
export {
  getDefaultLLMConfig,
  DEFAULT_BEDROCK_CHAT_MODEL,
  DEFAULT_BEDROCK_EMBEDDING_MODEL,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
} from './types';

// Keep legacy exports for backward compatibility during migration
export { getBedrockProvider, DEFAULT_MODEL } from './bedrock-client';
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/apple/.superset/worktrees/chatbot/playground && bunx tsc --noEmit -p libs/ai/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add libs/ai/src/index.ts
git commit -m "feat(ai): export new provider types and factory"
```

---

## Task 8: Wire Tenant Config into `/api/chat`

**Files:**
- Modify: `apps/web-ui/app/api/chat/route.ts`

- [ ] **Step 1: Rewrite imports and handler body**

```typescript
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  AuditService,
  MessageService,
  ConversationService,
  createLogger,
  TenantConfigService,
} from '@chatbot/shared';
import { streamChat, createLLMProvider, type TenantLLMConfig } from '@chatbot/ai';
import { authOptions } from '@/lib/auth';

const logger = createLogger('api:chat');

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const userId = await getSessionUserId(authOptions);

    const authError = await authorize('create', 'Chat', authOptions);
    if (authError) return authError;

    const { conversationId, content, model } = await req.json();

    const conversationService = new ConversationService(tenantId);
    const messageService = new MessageService(tenantId);

    let conversation;
    if (conversationId) {
      conversation = await conversationService.findById(conversationId);
      if (!conversation) {
        return new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 });
      }
    } else {
      conversation = await conversationService.create({
        userId,
        title: content.slice(0, 100),
        model,
      });
    }

    await messageService.create({
      conversationId: conversation.id,
      role: 'user',
      content,
    });

    const session = await getServerSession(authOptions);
    AuditService.logUserAction({
      eventType: 'chat.message.sent',
      action: 'Sent Message',
      resourceType: 'conversation',
      resourceId: conversation.id,
      resourceName: conversation.title || conversation.id,
      user: session?.user?.email || session?.user?.id || userId,
      userType: 'user',
      status: 'success',
      severity: 'low',
      details: `User sent a message in conversation ${conversation.id}`,
      apiRoute: 'POST /api/chat',
      httpMethod: 'POST',
      metadata: { conversationId: conversation.id, tenantId },
      tenantId,
    }).catch(() => {});

    // Resolve tenant LLM config
    const configService = new TenantConfigService(tenantId);
    const llmConfig = await configService.get<TenantLLMConfig>('llmConfig');
    const provider = createLLMProvider(llmConfig);

    const messages = await messageService.findByConversationId(conversation.id);
    const coreMessages = messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    const result = streamChat({
      provider,
      messages: coreMessages,
      model,
      onFinish: async ({ text, usage }) => {
        await messageService.create({
          conversationId: conversation.id,
          role: 'assistant',
          content: text,
          tokenCount: usage.outputTokens ?? 0,
        });
        await conversationService.update(conversation.id, {
          messageCount: messages.length + 2,
        });
      },
    });

    return result.toUIMessageStreamResponse({
      headers: { 'x-conversation-id': conversation.id },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
    }
    logger.error({ error }, 'Chat error');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles for web-ui**

Run: `cd /Users/apple/.superset/worktrees/chatbot/playground && bunx tsc --noEmit -p apps/web-ui/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/api/chat/route.ts
git commit -m "feat(api/chat): use tenant-configurable LLM provider"
```

---

## Task 9: Wire Tenant Config into `/api/agents/[id]/playground`

**Files:**
- Modify: `apps/web-ui/app/api/agents/[id]/playground/route.ts`

- [ ] **Step 1: Add imports and resolve provider before `streamChat`**

Add imports:
```typescript
import {
  getSessionTenantId,
  getSessionUserId,
  authorize,
  getPrismaClient,
  createLogger,
  TenantConfigService,
} from '@chatbot/shared';
import { streamChat, createLLMProvider, type TenantLLMConfig } from '@chatbot/ai';
```

Inside the handler, after `const { id } = await params;` and before agent fetch, add:
```typescript
    const configService = new TenantConfigService(tenantId);
    const llmConfig = await configService.get<TenantLLMConfig>('llmConfig');
    const provider = createLLMProvider(llmConfig);
```

Then change the `streamChat` call from:
```typescript
      const result = streamChat({
        messages: coreMessages,
        model: effectiveModel,
        system: effectiveSystem,
        temperature: effectiveTemperature,
        maxOutputTokens: simpleConfig.maxTokens ?? 4096,
        onFinish: async ({ text, usage }) => {
```

To:
```typescript
      const result = streamChat({
        provider,
        messages: coreMessages,
        model: effectiveModel,
        system: effectiveSystem,
        temperature: effectiveTemperature,
        maxOutputTokens: simpleConfig.maxTokens ?? 4096,
        onFinish: async ({ text, usage }) => {
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/apple/.superset/worktrees/chatbot/playground && bunx tsc --noEmit -p apps/web-ui/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/api/agents/\[id\]/playground/route.ts
git commit -m "feat(api/playground): use tenant-configurable LLM provider"
```

---

## Task 10: Wire Tenant Config into Conversation Summary Worker

**Files:**
- Modify: `apps/workers/src/jobs/conversation-summary/handler.ts`

- [ ] **Step 1: Resolve tenant config before `streamChat`**

Add imports:
```typescript
import { getPrismaClient, conversationSummaryJobSchema, TenantConfigService } from '@chatbot/shared/workers';
import { streamChat, createLLMProvider, type TenantLLMConfig } from '@chatbot/ai';
```

The job payload must include `tenantId`. We need to check the `conversationSummaryJobSchema` to see if it already includes `tenantId`. If not, we need to read it from the `conversation` record.

After fetching messages, add:
```typescript
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { tenantId: true },
  });
  if (!conversation) {
    log.warn('Conversation not found', { conversationId });
    return;
  }

  const configService = new TenantConfigService(conversation.tenantId);
  const llmConfig = await configService.get<TenantLLMConfig>('llmConfig');
  const provider = createLLMProvider(llmConfig);
```

Then change:
```typescript
  const result = streamChat({
    provider,
    messages: [
      {
        role: 'user',
        content: `Summarize this conversation concisely in 2-3 sentences:\n\n${conversationText}`,
      },
    ],
    system: 'You are a helpful assistant that creates concise conversation summaries.',
    maxOutputTokens: 256,
  });
```

- [ ] **Step 2: Verify TypeScript compiles for workers**

Run: `cd /Users/apple/.superset/worktrees/chatbot/playground && bunx tsc --noEmit -p apps/workers/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/workers/src/jobs/conversation-summary/handler.ts
git commit -m "feat(workers): use tenant-configurable LLM provider in conversation summary"
```

---

## Task 11: Add `llmConfig` to Tenant Settings API

**Files:**
- Modify: `apps/web-ui/app/api/tenants/settings/route.ts`

- [ ] **Step 1: Extend the Zod schema and GET handler**

Update imports to include `TenantLLMConfig` from `@chatbot/ai`:
```typescript
import { getPrismaClient, getSessionTenantId, authorize, TenantConfigService, AuditService } from '@chatbot/shared';
import type { TenantLLMConfig } from '@chatbot/ai';
```

Update `updateSchema`:
```typescript
const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().optional(),
  notifications: z.object({
    scheduleExecutions: z.boolean().optional(),
    memberInvites: z.boolean().optional(),
    systemAlerts: z.boolean().optional(),
  }).optional(),
  llmConfig: z.object({
    provider: z.enum(['bedrock', 'openai']),
    chatModel: z.string().optional(),
    embeddingModel: z.string().optional(),
    embeddingDimensions: z.number().optional(),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
  }).optional(),
});
```

Update GET handler to read `llmConfig`:
```typescript
    const [timezone, notifications, llmConfig] = await Promise.all([
      configService.get<string>('timezone'),
      configService.get<Record<string, boolean>>('notifications'),
      configService.get<TenantLLMConfig>('llmConfig'),
    ]);

    return NextResponse.json({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      timezone: timezone ?? 'UTC',
      notifications: {
        scheduleExecutions: true,
        memberInvites: true,
        systemAlerts: true,
        ...notifications,
      },
      llmConfig: llmConfig ?? null,
    });
```

- [ ] **Step 2: Extend the PUT handler**

After the `notifications` block, add:
```typescript
    let existingLlmConfig: TenantLLMConfig | null = null;
    if (parsed.data.llmConfig !== undefined) {
      existingLlmConfig = await configService.get<TenantLLMConfig>('llmConfig');
      const merged: TenantLLMConfig = {
        ...existingLlmConfig,
        ...parsed.data.llmConfig,
      };
      // If apiKey is empty or masked, keep existing
      if (
        parsed.data.llmConfig.apiKey === '' ||
        parsed.data.llmConfig.apiKey === '••••••'
      ) {
        merged.apiKey = existingLlmConfig?.apiKey;
      }
      await configService.set('llmConfig', merged, userId);
    }
```

Update the re-read after write:
```typescript
    const [savedTimezone, savedNotifications, savedLlmConfig] = await Promise.all([
      configService.get<string>('timezone'),
      configService.get<Record<string, boolean>>('notifications'),
      configService.get<TenantLLMConfig>('llmConfig'),
    ]);
```

Update the response:
```typescript
    return NextResponse.json({
      id: tenant?.id,
      name: tenant?.name,
      slug: tenant?.slug,
      status: tenant?.status,
      timezone: savedTimezone ?? 'UTC',
      notifications: {
        scheduleExecutions: true,
        memberInvites: true,
        systemAlerts: true,
        ...savedNotifications,
      },
      llmConfig: savedLlmConfig ?? null,
    });
```

Update audit metadata:
```typescript
      metadata: { tenantId, name, timezone, notifications, llmProvider: parsed.data.llmConfig?.provider },
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/apple/.superset/worktrees/chatbot/playground && bunx tsc --noEmit -p apps/web-ui/tsconfig.json`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/app/api/tenants/settings/route.ts
git commit -m "feat(api/settings): add llmConfig to tenant settings endpoints"
```

---

## Task 12: Add LLM Provider Selector to Organization Settings UI

**Files:**
- Modify: `apps/web-ui/app/(dashboard)/settings/organization/page.tsx`

- [ ] **Step 1: Update the `TenantSettings` interface**

```typescript
interface TenantSettings {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  timezone: string;
  notifications: {
    systemAlerts: boolean;
  };
  llmConfig: {
    provider: 'bedrock' | 'openai';
    chatModel?: string;
    baseUrl?: string;
    apiKey?: string;
  } | null;
}
```

- [ ] **Step 2: Update the form schema and default values**

```typescript
const orgFormSchema = z.object({
  name: z.string().min(1, 'Organization name is required.'),
  timezone: z.string(),
  systemAlerts: z.boolean(),
  llmProvider: z.enum(['bedrock', 'openai']),
  llmChatModel: z.string().optional(),
  llmBaseUrl: z.string().optional(),
  llmApiKey: z.string().optional(),
});

type OrgFormValues = z.infer<typeof orgFormSchema>;
```

Update `defaultValues`:
```typescript
    defaultValues: {
      name: '',
      timezone: 'UTC',
      systemAlerts: true,
      llmProvider: 'bedrock',
      llmChatModel: '',
      llmBaseUrl: '',
      llmApiKey: '',
    } as OrgFormValues,
```

- [ ] **Step 3: Update `fetchSettings` to hydrate LLM fields**

```typescript
      form.setFieldValue('systemAlerts', data.notifications.systemAlerts);
      const llm = data.llmConfig;
      form.setFieldValue('llmProvider', llm?.provider ?? 'bedrock');
      form.setFieldValue('llmChatModel', llm?.chatModel ?? '');
      form.setFieldValue('llmBaseUrl', llm?.baseUrl ?? '');
      form.setFieldValue('llmApiKey', llm?.apiKey ? '••••••' : '');
```

- [ ] **Step 4: Update `onSubmit` to include `llmConfig`**

```typescript
          body: JSON.stringify({
            name: value.name.trim(),
            timezone: value.timezone,
            notifications: {
              systemAlerts: value.systemAlerts,
            },
            llmConfig: {
              provider: value.llmProvider,
              chatModel: value.llmChatModel || undefined,
              baseUrl: value.llmBaseUrl || undefined,
              apiKey: value.llmApiKey || undefined,
            },
          }),
```

- [ ] **Step 5: Add a new "AI Provider" card in the JSX**

Insert this card after the "Organization Details" card (before or after "Preferences" card — either works, but after "Preferences" is fine too):

```tsx
            <Card>
              <CardHeader>
                <CardTitle>AI Provider</CardTitle>
                <CardDescription>Configure the LLM provider used for chat inference in your organization.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form.Field
                  name="llmProvider"
                  children={(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Provider</Label>
                      <Select
                        value={field.state.value}
                        onValueChange={(value) => field.handleChange(value as 'bedrock' | 'openai')}
                        disabled={!canEdit}
                      >
                        <SelectTrigger id={field.name} className="w-full">
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bedrock">Amazon Bedrock</SelectItem>
                          <SelectItem value="openai">OpenAI Compatible (Ollama, vLLM, etc.)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                />

                <form.Subscribe
                  selector={(state) => state.values.llmProvider}
                  children={(provider) => (
                    <>
                      <form.Field
                        name="llmChatModel"
                        children={(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Chat Model</Label>
                            <Input
                              id={field.name}
                              name={field.name}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => field.handleChange(e.target.value)}
                              disabled={!canEdit}
                              placeholder={provider === 'bedrock' ? 'anthropic.claude-sonnet-4-20250514' : 'gpt-4o'}
                            />
                            <p className="text-xs text-muted-foreground">
                              {provider === 'bedrock'
                                ? 'Bedrock model ID (e.g., anthropic.claude-sonnet-4-20250514)'
                                : 'Model name exposed by the OpenAI-compatible endpoint'}
                            </p>
                          </div>
                        )}
                      />

                      {provider === 'openai' && (
                        <>
                          <form.Field
                            name="llmBaseUrl"
                            children={(field) => (
                              <div className="space-y-2">
                                <Label htmlFor={field.name}>Base URL</Label>
                                <Input
                                  id={field.name}
                                  name={field.name}
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={(e) => field.handleChange(e.target.value)}
                                  disabled={!canEdit}
                                  placeholder="http://localhost:11434/v1"
                                />
                                <p className="text-xs text-muted-foreground">
                                  OpenAI-compatible API base URL (e.g., Ollama: http://localhost:11434/v1)
                                </p>
                              </div>
                            )}
                          />

                          <form.Field
                            name="llmApiKey"
                            children={(field) => (
                              <div className="space-y-2">
                                <Label htmlFor={field.name}>API Key</Label>
                                <Input
                                  id={field.name}
                                  name={field.name}
                                  type="password"
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={(e) => field.handleChange(e.target.value)}
                                  disabled={!canEdit}
                                  placeholder={field.state.value === '••••••' ? '••••••' : 'Optional for local endpoints'}
                                />
                                <p className="text-xs text-muted-foreground">
                                  Leave blank to keep existing key. Not required for local endpoints like Ollama.
                                </p>
                              </div>
                            )}
                          />
                        </>
                      )}
                    </>
                  )}
                />
              </CardContent>
            </Card>
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd /Users/apple/.superset/worktrees/chatbot/playground && bunx tsc --noEmit -p apps/web-ui/tsconfig.json`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web-ui/app/\(dashboard\)/settings/organization/page.tsx
git commit -m "feat(ui): add LLM provider selector to organization settings"
```

---

## Task 13: Final Verification

- [ ] **Step 1: Run full TypeScript check**

```bash
cd /Users/apple/.superset/worktrees/chatbot/playground
bun run build
```
Expected: No type errors across all projects.

- [ ] **Step 2: Run unit tests for `libs/ai`**

```bash
cd /Users/apple/.superset/worktrees/chatbot/playground
nx test ai
```
Expected: All tests pass (update mocks if needed).

- [ ] **Step 3: Run dev server smoke test**

```bash
cd /Users/apple/.superset/worktrees/chatbot/playground
bun run dev
```
Wait for "Ready in" in the output. No runtime errors on startup.

- [ ] **Step 4: Commit any test fixes**

```bash
git add -A
git commit -m "test(ai): update tests for LLM provider abstraction"
```

---

## Spec Coverage Checklist

| Spec Requirement | Task |
|---|---|
| `LLMProvider` interface | Task 1 |
| `TenantLLMConfig` type | Task 1 |
| `BedrockLLMProvider` | Task 2 |
| `OpenAICompatibleProvider` with `baseURL` | Task 3 |
| `createLLMProvider` factory | Task 4 |
| Chat inference delegates to provider | Task 5, 8, 9 |
| Embeddings delegate to provider | Task 6 |
| `/api/chat` reads tenant config | Task 8 |
| `/api/agents/[id]/playground` reads tenant config | Task 9 |
| Conversation summary worker reads tenant config | Task 10 |
| Tenant settings API exposes `llmConfig` | Task 11 |
| UI for provider selection | Task 12 |
| API key masked in UI / never returned empty | Task 11, 12 |
| Message embeddings unchanged (global default) | — (not touched) |
| KB embeddings unchanged | — (not touched) |

---

*Plan written 2026-05-06. Ready for execution.*

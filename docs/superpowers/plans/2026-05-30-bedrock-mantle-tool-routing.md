# Bedrock Mantle Tool Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-route Bedrock tool calls to the OpenAI-compatible `bedrock-mantle` endpoint for models (DeepSeek, Kimi) that don't support tool calling via the Converse API, so MCP tools work correctly regardless of which model the user picks.

**Architecture:** The `BedrockLLMProvider.streamChat` method detects at call time whether the selected model needs `bedrock-mantle` (based on model ID prefix). When tools are present and the model is in the mantle list, it constructs an `@ai-sdk/openai` client pointed at `https://bedrock-mantle.{region}.api.aws/v1` and uses `AWS_BEARER_TOKEN_BEDROCK` for auth. All other models continue using the existing Converse API path unchanged.

**Tech Stack:** `@ai-sdk/openai` (already a dependency), `AWS_BEARER_TOKEN_BEDROCK` env var (already present in `.env.example`), Vitest for tests.

---

## Background

AWS Bedrock has two endpoints:
- **`bedrock-runtime`** (Converse API) — native to Claude, Nova, Llama, Cohere, Mistral. Tool calling works correctly.
- **`bedrock-mantle`** (OpenAI-compatible API) — used by DeepSeek, Kimi, and other third-party models. AWS explicitly recommends this endpoint for those models. Tool calling works correctly here.

When DeepSeek or Kimi receive tool definitions via the Converse API, their internal tool-call tokens leak into text output (e.g. `<｜DSML｜function_calls`). This is not a bug in our code — it's a fundamental mismatch. The fix is routing to `bedrock-mantle` for these models when tools are involved.

**Models requiring `bedrock-mantle` for tool calling** (prefix-based detection):
- `deepseek.` — DeepSeek V3.1, V3.2 (AWS docs show no `tools` field in their Converse schema)
- `moonshotai.` — Kimi K2.5 (AWS docs say "whenever possible, use bedrock-mantle")

**Models that stay on Converse API (unchanged):**
- `anthropic.*` / `us.anthropic.*` etc — Claude (does NOT support bedrock-mantle at all)
- `amazon.*` — Nova
- `meta.*` — Llama 3.x
- `cohere.*`, `mistral.*` — work fine on Converse

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `libs/ai/src/env.ts` | Modify | Add `AWS_BEARER_TOKEN_BEDROCK` to env schema |
| `libs/ai/src/providers/bedrock.ts` | Modify | Add mantle detection + routing in `streamChat` |
| `libs/ai/src/providers/bedrock.test.ts` | Create | Unit tests for the routing logic |

---

## Task 1: Add `AWS_BEARER_TOKEN_BEDROCK` to env schema

**Files:**
- Modify: `libs/ai/src/env.ts`

- [ ] **Step 1: Update env.ts to declare the var**

Replace the contents of `libs/ai/src/env.ts` with:

```typescript
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    AWS_REGION: z.string().min(1).default("ap-south-1"),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_SESSION_TOKEN: z.string().optional(),
    AWS_BEARER_TOKEN_BEDROCK: z.string().optional(),
  },
  client: {},
  clientPrefix: "NEXT_PUBLIC_",
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
```

- [ ] **Step 2: Verify the app still starts without error**

Run: `bunx tsc --noEmit -p libs/ai/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add libs/ai/src/env.ts
git commit -m "feat(ai): add AWS_BEARER_TOKEN_BEDROCK to env schema"
```

---

## Task 2: Write failing tests for the routing logic

**Files:**
- Create: `libs/ai/src/providers/bedrock.test.ts`

- [ ] **Step 1: Create the test file**

Create `libs/ai/src/providers/bedrock.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must be hoisted before any imports that trigger the modules
vi.mock('ai', () => ({
  streamText: vi.fn().mockReturnValue({
    textStream: (async function* () {})(),
    text: Promise.resolve(''),
    usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
  }),
  embed: vi.fn(),
  embedMany: vi.fn(),
}));

vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: vi.fn(() => vi.fn(() => 'mock-bedrock-model')),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn(() => 'mock-openai-model')),
}));

vi.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: vi.fn(() =>
    vi.fn(() => Promise.resolve({ accessKeyId: 'test-key', secretAccessKey: 'test-secret' }))
  ),
}));

// Set the bearer token env var before importing bedrock provider
process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'test-bedrock-token';

import { BedrockLLMProvider } from './bedrock';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

const MOCK_MESSAGES = [{ role: 'user' as const, content: 'hello' }];
const MOCK_TOOL = {
  myTool: {
    description: 'test tool',
    inputSchema: { type: 'object', properties: {} } as any,
    execute: async () => 'result',
  },
};

describe('BedrockLLMProvider — mantle routing', () => {
  let provider: BedrockLLMProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new BedrockLLMProvider({ provider: 'bedrock', region: 'us-east-1' });
  });

  it('uses Converse API (createAmazonBedrock) for Claude with tools', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'anthropic.claude-3-haiku-20240307-v1:0',
      tools: MOCK_TOOL,
    });

    expect(createAmazonBedrock).toHaveBeenCalled();
    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it('uses Converse API for cross-region Claude with tools', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'us.anthropic.claude-sonnet-4-6',
      tools: MOCK_TOOL,
    });

    expect(createAmazonBedrock).toHaveBeenCalled();
    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it('uses Converse API for Amazon Nova with tools', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'amazon.nova-pro-v1:0',
      tools: MOCK_TOOL,
    });

    expect(createAmazonBedrock).toHaveBeenCalled();
    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it('uses bedrock-mantle (createOpenAI) for deepseek with tools', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'deepseek.v3.2',
      tools: MOCK_TOOL,
    });

    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://bedrock-mantle.us-east-1.api.aws/v1',
        apiKey: 'test-bedrock-token',
      })
    );
    expect(createAmazonBedrock).toHaveBeenCalledTimes(1); // only called in constructor
  });

  it('uses bedrock-mantle for moonshotai (Kimi) with tools', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'moonshotai.kimi-k2.5',
      tools: MOCK_TOOL,
    });

    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://bedrock-mantle.us-east-1.api.aws/v1',
        apiKey: 'test-bedrock-token',
      })
    );
  });

  it('uses Converse API for deepseek WITHOUT tools', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'deepseek.v3.2',
      // no tools — plain text, Converse API works fine
    });

    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it('uses Converse API for moonshotai WITHOUT tools', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'moonshotai.kimi-k2.5',
    });

    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it('passes tools and maxSteps to streamText when using mantle', () => {
    provider.streamChat({
      messages: MOCK_MESSAGES,
      model: 'deepseek.v3.2',
      tools: MOCK_TOOL,
      maxSteps: 3,
    });

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: MOCK_TOOL,
        maxSteps: 3,
      })
    );
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /path/to/repo && bunx nx test ai --testFile=libs/ai/src/providers/bedrock.test.ts
```

Expected: Tests fail with errors like `createOpenAI is not called` or import errors.

---

## Task 3: Implement the routing logic in the Bedrock provider

**Files:**
- Modify: `libs/ai/src/providers/bedrock.ts`

- [ ] **Step 1: Add the `needsMantleForTools` helper and update `streamChat`**

Replace the full contents of `libs/ai/src/providers/bedrock.ts` with:

```typescript
import { streamText, embed, embedMany } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createOpenAI } from '@ai-sdk/openai';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import type { LLMProvider, BaseStreamChatOptions, StreamChatResult } from '../provider';
import type { TenantLLMConfig, ProviderName } from '../types';
import {
  DEFAULT_BEDROCK_CHAT_MODEL,
  DEFAULT_BEDROCK_EMBEDDING_MODEL,
} from '../types';
import { env } from '../env';

// Models where Bedrock Converse API does not support tool calling.
// AWS themselves recommend using the bedrock-mantle (OpenAI-compatible) endpoint for these.
// Sources:
//   - DeepSeek V3.2 model card: no `tools` field in Converse request schema
//   - Kimi K2.5 model card: "Whenever possible, use bedrock-mantle"
const MANTLE_TOOL_PREFIXES = ['deepseek.', 'moonshotai.'];

function needsMantleForTools(modelId: string): boolean {
  return MANTLE_TOOL_PREFIXES.some((prefix) => modelId.startsWith(prefix));
}

export class BedrockLLMProvider implements LLMProvider {
  readonly name: ProviderName = 'bedrock';
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  readonly region: string;
  private readonly hasExplicitCredentials: boolean;

  private readonly client: ReturnType<typeof createAmazonBedrock>;

  constructor(config: TenantLLMConfig) {
    this.chatModel = config.chatModel ?? DEFAULT_BEDROCK_CHAT_MODEL;
    this.embeddingModel = config.embeddingModel ?? DEFAULT_BEDROCK_EMBEDDING_MODEL;
    this.embeddingDimensions = config.embeddingDimensions ?? 1024;
    this.region = config.region ?? env.AWS_REGION;
    this.hasExplicitCredentials = !!(config.accessKeyId && config.secretAccessKey);

    this.client = createAmazonBedrock({
      region: this.region,
      ...(this.hasExplicitCredentials
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : { credentialProvider: defaultProvider() }),
    });
  }

  streamChat(options: BaseStreamChatOptions): StreamChatResult {
    const {
      messages,
      model,
      system,
      temperature = 0.7,
      maxOutputTokens = 4096,
      tools,
      maxSteps,
      onFinish,
    } = options;

    const effectiveModel = model ?? this.chatModel;
    const hasTools = !!tools && Object.keys(tools).length > 0;

    // Route to bedrock-mantle for models that don't support Converse API tool calling
    if (hasTools && needsMantleForTools(effectiveModel)) {
      const mantleClient = createOpenAI({
        baseURL: `https://bedrock-mantle.${this.region}.api.aws/v1`,
        apiKey: env.AWS_BEARER_TOKEN_BEDROCK,
      });
      return streamText({
        model: mantleClient(effectiveModel),
        messages,
        system,
        temperature,
        maxOutputTokens,
        tools,
        maxSteps: maxSteps ?? 5,
        onFinish,
      });
    }

    // Default: Converse API (works for Claude, Nova, Llama, Cohere, Mistral, etc.)
    return streamText({
      model: this.client(effectiveModel),
      messages,
      system,
      temperature,
      maxOutputTokens,
      ...(hasTools ? { tools, maxSteps: maxSteps ?? 5 } : {}),
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

  async validate(): Promise<void> {
    if (this.hasExplicitCredentials) {
      return;
    }

    try {
      const credentials = await defaultProvider()();
      if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
        throw new Error('Incomplete AWS credentials');
      }
    } catch {
      throw new Error(
        'AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or configure ~/.aws/credentials.'
      );
    }
  }
}
```

- [ ] **Step 2: Run the tests — they should pass now**

```bash
bunx nx test ai --testFile=libs/ai/src/providers/bedrock.test.ts
```

Expected: All 8 tests pass.

- [ ] **Step 3: Run the full ai test suite to confirm nothing regressed**

```bash
bunx nx test ai
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add libs/ai/src/providers/bedrock.ts libs/ai/src/providers/bedrock.test.ts libs/ai/src/env.ts
git commit -m "feat(ai): auto-route deepseek/moonshotai tool calls to bedrock-mantle

Models like DeepSeek and Kimi K2.5 do not support tool calling via Bedrock
Converse API — their internal tokens leak into text output. AWS recommends
using the bedrock-mantle (OpenAI-compatible) endpoint for these models.

When streamChat is called with tools and the model ID starts with 'deepseek.'
or 'moonshotai.', the request is routed to bedrock-mantle using
AWS_BEARER_TOKEN_BEDROCK for auth. All other models continue using the
existing Converse API path unchanged.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Manual smoke test

- [ ] **Step 1: Start the app (if not already running)**

```bash
bun run dev
```

- [ ] **Step 2: Test DeepSeek with MCP tools**

In the playground, configure a simple agent with:
- Model: `deepseek.v3.2`
- MCP server: `stox-mcp-test-v1` attached

Send: `"do a health check and tell me the status"`

Expected: The model calls the MCP tool, gets a result, and returns a proper text response. No `<｜DSML｜function_calls` in the output.

- [ ] **Step 3: Confirm Claude still works with MCP tools**

Switch the model to `anthropic.claude-3-5-haiku-20241022-v1:0` and repeat the same prompt.

Expected: Works as before. No regression.

- [ ] **Step 4: Check the dev logs confirm correct routing**

```bash
tail -50 /private/tmp/chatbot-dev.log
```

For DeepSeek with tools, you should see `createOpenAI` being used internally (no log currently, but no errors). For Claude, the existing Converse API path is used.

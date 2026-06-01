# Memory Summary Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `summary` memory strategy so it actually summarizes older messages via LLM and returns a condensed history instead of passing messages through unchanged.

**Architecture:** Add a `keepRecent` config field (default 6) controlling how many recent messages are preserved verbatim. When `messages.length > keepRecent`, the executor calls the tenant LLM to summarize the older portion and prepends the result as a `system` message before the recent messages. If there's nothing to summarize, no LLM call is made.

**Tech Stack:** TypeScript, Zod, Vitest, TanStack Form, shadcn/ui Input, Vercel AI SDK streaming

---

## Files

| Action | Path |
|---|---|
| Modify | `libs/agent-studio/src/registry/schemas/memory.ts` |
| Modify | `libs/agent-studio/src/types/nodes.ts` |
| Modify | `libs/agent-studio/src/execution/node-executors/memory-executor.ts` |
| Modify | `libs/agent-studio/src/execution/node-executors/node-executors.test.ts` |
| Modify | `apps/web-ui/components/agents/config/memory-node-form.tsx` |

---

## Task 1: Add `keepRecent` to schema and types

**Files:**
- Modify: `libs/agent-studio/src/registry/schemas/memory.ts`
- Modify: `libs/agent-studio/src/types/nodes.ts`

- [ ] **Step 1: Update the Zod schema**

Replace the contents of `libs/agent-studio/src/registry/schemas/memory.ts`:

```typescript
import { z } from 'zod';

export const memoryNodeSchema = z.object({
  type: z.literal('memory'),
  strategy: z.enum(['full', 'sliding_window', 'summary', 'token_limit']),
  maxMessages: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  messagesChannel: z.string().min(1, 'Messages channel is required'),
  keepRecent: z.number().int().min(1).default(6).optional(),
});
```

- [ ] **Step 2: Update the TypeScript interface**

In `libs/agent-studio/src/types/nodes.ts`, find `MemoryNodeConfig` and add `keepRecent`:

```typescript
export interface MemoryNodeConfig {
  type: 'memory';
  strategy: 'full' | 'sliding_window' | 'summary' | 'token_limit';
  maxMessages?: number;
  maxTokens?: number;
  messagesChannel: string;
  /** Number of recent messages to keep verbatim in summary mode (default: 6) */
  keepRecent?: number;
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
git add libs/agent-studio/src/registry/schemas/memory.ts \
        libs/agent-studio/src/types/nodes.ts
git commit -m "feat(memory): add keepRecent field to MemoryNodeConfig schema"
```

---

## Task 2: Write failing tests for summary strategy

**Files:**
- Modify: `libs/agent-studio/src/execution/node-executors/node-executors.test.ts`

- [ ] **Step 1: Add the test block**

In `node-executors.test.ts`, after the existing `MemoryNodeExecutor` describe block (or after the RouterNodeExecutor NL mode block), add:

```typescript
describe('MemoryNodeExecutor — summary strategy', () => {
  const executor = new MemoryNodeExecutor();

  const baseMessages = [
    { role: 'user' as const, content: 'Hello' },
    { role: 'assistant' as const, content: 'Hi there' },
    { role: 'user' as const, content: 'What is 2+2?' },
    { role: 'assistant' as const, content: '4' },
    { role: 'user' as const, content: 'Tell me about Paris' },
    { role: 'assistant' as const, content: 'Paris is the capital of France' },
    { role: 'user' as const, content: 'What about London?' },
    { role: 'assistant' as const, content: 'London is the capital of the UK' },
  ];

  function makeCtx(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    keepRecent: number,
    llmResponse: string,
  ) {
    const mockStreamChat = vi.fn().mockReturnValue({
      textStream: (async function* () { yield llmResponse; })(),
    });
    return createMockContext({
      node: createMockNode({ id: 'memory-1', type: 'memory', label: 'Memory' }),
      config: {
        type: 'memory',
        strategy: 'summary',
        messagesChannel: 'messages',
        keepRecent,
      },
      state: createMockState({ channels: { messages } }),
      services: {
        llmProvider: vi.fn().mockResolvedValue({ streamChat: mockStreamChat }),
        prisma: {},
      },
    });
  }

  it('returns messages unchanged when count <= keepRecent (no LLM call)', async () => {
    const messages = baseMessages.slice(0, 4); // 4 messages
    const mockStreamChat = vi.fn();
    const llmProvider = vi.fn().mockResolvedValue({ streamChat: mockStreamChat });
    const ctx = createMockContext({
      node: createMockNode({ id: 'memory-1', type: 'memory', label: 'Memory' }),
      config: { type: 'memory', strategy: 'summary', messagesChannel: 'messages', keepRecent: 6 },
      state: createMockState({ channels: { messages } }),
      services: { llmProvider, prisma: {} },
    });
    const result = await executor.execute(ctx);
    expect(result.stateUpdates.messages).toEqual(messages);
    expect(llmProvider).not.toHaveBeenCalled();
  });

  it('calls llmProvider and prepends summary when count > keepRecent', async () => {
    const ctx = makeCtx(baseMessages, 4, 'User asked about math and cities.');
    const result = await executor.execute(ctx);
    const updated = result.stateUpdates.messages as Array<{ role: string; content: string }>;
    // First message should be the summary
    expect(updated[0].role).toBe('system');
    expect(updated[0].content).toContain('User asked about math and cities.');
    // Last 4 messages preserved verbatim
    expect(updated.slice(1)).toEqual(baseMessages.slice(-4));
  });

  it('summary system message contains the correct prefix', async () => {
    const ctx = makeCtx(baseMessages, 4, 'A summary of the chat.');
    const result = await executor.execute(ctx);
    const updated = result.stateUpdates.messages as Array<{ role: string; content: string }>;
    expect(updated[0].content).toBe('Summary of earlier conversation:\nA summary of the chat.');
  });

  it('includes older messages in the LLM summarization prompt', async () => {
    const mockStreamChat = vi.fn().mockReturnValue({
      textStream: (async function* () { yield 'summary'; })(),
    });
    const llmProvider = vi.fn().mockResolvedValue({ streamChat: mockStreamChat });
    const ctx = createMockContext({
      node: createMockNode({ id: 'memory-1', type: 'memory', label: 'Memory' }),
      config: { type: 'memory', strategy: 'summary', messagesChannel: 'messages', keepRecent: 4 },
      state: createMockState({ channels: { messages: baseMessages } }),
      services: { llmProvider, prisma: {} },
    });
    await executor.execute(ctx);
    const callArgs = mockStreamChat.mock.calls[0][0];
    const promptText = JSON.stringify(callArgs.messages);
    // Older messages (first 4) should be in the prompt
    expect(promptText).toContain('Hello');
    expect(promptText).toContain('What is 2+2?');
    // Recent messages (last 4) should NOT be in the prompt
    expect(promptText).not.toContain('What about London?');
  });

  it('propagates error when llmProvider rejects', async () => {
    const llmProvider = vi.fn().mockRejectedValue(new Error('provider down'));
    const ctx = createMockContext({
      node: createMockNode({ id: 'memory-1', type: 'memory', label: 'Memory' }),
      config: { type: 'memory', strategy: 'summary', messagesChannel: 'messages', keepRecent: 2 },
      state: createMockState({ channels: { messages: baseMessages } }),
      services: { llmProvider, prisma: {} },
    });
    await expect(executor.execute(ctx)).rejects.toThrow('provider down');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
bunx vitest run libs/agent-studio/src/execution/node-executors/node-executors.test.ts --reporter=verbose 2>&1 | grep -A3 "summary strategy"
```

Expected: tests in `MemoryNodeExecutor — summary strategy` fail because `summary` still returns messages unchanged.

---

## Task 3: Implement summary strategy in memory executor

**Files:**
- Modify: `libs/agent-studio/src/execution/node-executors/memory-executor.ts`

- [ ] **Step 1: Replace the executor implementation**

Replace the full contents of `libs/agent-studio/src/execution/node-executors/memory-executor.ts`:

```typescript
import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { MemoryNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:memory-executor');

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class MemoryNodeExecutor implements NodeExecutor {
  type = 'memory';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as MemoryNodeConfig;
    const startedAt = new Date().toISOString();

    const raw = ctx.state.channels[config.messagesChannel] ?? ctx.state.messages;
    const messages: Message[] = Array.isArray(raw) ? (raw as Message[]) : [];

    const processed =
      config.strategy === 'summary'
        ? await this.applySummaryStrategy(messages, config, ctx)
        : this.applyStrategy(messages, config);

    logger.info(
      { nodeId: ctx.node.id, strategy: config.strategy, input: messages.length, output: processed.length },
      'memory strategy applied',
    );

    return {
      stateUpdates: { [config.messagesChannel]: processed },
      next: null,
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'memory',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { strategy: config.strategy, originalCount: messages.length },
        output: { resultCount: processed.length },
      },
    };
  }

  private applyStrategy(messages: Message[], config: MemoryNodeConfig): Message[] {
    switch (config.strategy) {
      case 'full':
        return messages;

      case 'sliding_window': {
        const max = config.maxMessages ?? 20;
        return messages.slice(-max);
      }

      case 'token_limit': {
        const limit = config.maxTokens ?? 4000;
        const result: Message[] = [];
        let tokens = 0;
        for (let i = messages.length - 1; i >= 0; i--) {
          const estimated = Math.ceil(messages[i].content.length / 4);
          if (tokens + estimated > limit) break;
          tokens += estimated;
          result.unshift(messages[i]);
        }
        return result;
      }

      default:
        return messages;
    }
  }

  private async applySummaryStrategy(
    messages: Message[],
    config: MemoryNodeConfig,
    ctx: NodeExecutionContext,
  ): Promise<Message[]> {
    const keepRecent = config.keepRecent ?? 6;

    if (messages.length <= keepRecent) {
      return messages;
    }

    const old = messages.slice(0, messages.length - keepRecent);
    const recent = messages.slice(-keepRecent);

    try {
      const provider = await ctx.services.llmProvider();

      const conversationText = old
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');

      const streamResult = provider.streamChat({
        messages: [
          {
            role: 'user',
            content: `Summarize the following conversation concisely, preserving key facts and context:\n\n${conversationText}`,
          },
        ],
        temperature: 0,
        maxOutputTokens: 512,
      });

      let summary = '';
      for await (const chunk of streamResult.textStream) {
        summary += chunk;
      }

      logger.info(
        { nodeId: ctx.node.id, oldCount: old.length, keepRecent, summaryLength: summary.length },
        'memory summary generated',
      );

      return [
        { role: 'system', content: `Summary of earlier conversation:\n${summary}` },
        ...recent,
      ];
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'memory summary LLM call failed');
      throw error;
    }
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
bunx vitest run libs/agent-studio/src/execution/node-executors/node-executors.test.ts --reporter=verbose 2>&1 | grep -E "✓|✗|PASS|FAIL|summary"
```

Expected: all 5 summary strategy tests PASS, existing tests still PASS.

- [ ] **Step 3: Commit**

```bash
git add libs/agent-studio/src/execution/node-executors/memory-executor.ts \
        libs/agent-studio/src/execution/node-executors/node-executors.test.ts
git commit -m "feat(memory): implement summary strategy with LLM summarization"
```

---

## Task 4: Add `keepRecent` input to the memory node UI form

**Files:**
- Modify: `apps/web-ui/components/agents/config/memory-node-form.tsx`

- [ ] **Step 1: Update schema, defaultValues, onSubmit, and add the input**

Replace the full contents of `apps/web-ui/components/agents/config/memory-node-form.tsx`:

```typescript
'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MemoryNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  strategy: z.enum(['full', 'sliding_window', 'summary', 'token_limit']),
  maxMessages: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  messagesChannel: z.string().min(1, 'Messages channel is required'),
  keepRecent: z.number().int().min(1).optional(),
});

type MemoryFormValues = z.infer<typeof schema>;

interface MemoryNodeFormProps {
  config: MemoryNodeConfig;
  onChange: (config: MemoryNodeConfig) => void;
}

export function MemoryNodeForm({ config, onChange }: MemoryNodeFormProps) {
  const form = useForm({
    defaultValues: {
      strategy: config.strategy ?? 'full',
      maxMessages: config.maxMessages,
      maxTokens: config.maxTokens,
      messagesChannel: config.messagesChannel ?? 'messages',
      keepRecent: config.keepRecent ?? 6,
    } as MemoryFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'memory',
        strategy: value.strategy,
        maxMessages: value.strategy === 'sliding_window' ? value.maxMessages : undefined,
        maxTokens: value.strategy === 'token_limit' ? value.maxTokens : undefined,
        messagesChannel: value.messagesChannel,
        keepRecent: value.strategy === 'summary' ? (value.keepRecent ?? 6) : undefined,
      });
    },
  });

  const handleBlur = () => form.handleSubmit();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      <form.Field name="strategy">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Strategy</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                field.handleChange(v as MemoryFormValues['strategy']);
                handleBlur();
              }}
            >
              <SelectTrigger aria-label="Memory strategy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full</SelectItem>
                <SelectItem value="sliding_window">Sliding Window</SelectItem>
                <SelectItem value="summary">Summary (LLM)</SelectItem>
                <SelectItem value="token_limit">Token Limit</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <form.Field name="strategy">
        {(strategyField) =>
          strategyField.state.value === 'sliding_window' ? (
            <form.Field name="maxMessages">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Max Messages</Label>
                  <Input
                    id={field.name}
                    type="number"
                    min={1}
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
                    onBlur={() => { field.handleBlur(); handleBlur(); }}
                    placeholder="20"
                  />
                </div>
              )}
            </form.Field>
          ) : strategyField.state.value === 'token_limit' ? (
            <form.Field name="maxTokens">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Max Tokens</Label>
                  <Input
                    id={field.name}
                    type="number"
                    min={1}
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
                    onBlur={() => { field.handleBlur(); handleBlur(); }}
                    placeholder="4000"
                  />
                </div>
              )}
            </form.Field>
          ) : strategyField.state.value === 'summary' ? (
            <form.Field name="keepRecent">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Keep Recent Messages</Label>
                  <Input
                    id={field.name}
                    type="number"
                    min={1}
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
                    onBlur={() => { field.handleBlur(); handleBlur(); }}
                    placeholder="6"
                  />
                  <p className="text-xs text-muted-foreground">
                    Messages beyond this count will be summarized by the LLM.
                  </p>
                </div>
              )}
            </form.Field>
          ) : null
        }
      </form.Field>

      <form.Field name="messagesChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Messages Channel</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="messages"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/components/agents/config/memory-node-form.tsx
git commit -m "feat(canvas): add keepRecent input to memory node summary config"
```

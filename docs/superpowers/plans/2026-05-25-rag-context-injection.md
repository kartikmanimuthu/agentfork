# RAG Context Injection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `contextChannels` to `LlmNodeConfig` so the LLM executor prepends retrieved KB (or any channel) content into the last user message before the API call, enabling true RAG across all LLM providers.

**Architecture:** `contextChannels?: string[]` is added to `LlmNodeConfig` and the Zod schema. At execution time, the LLM executor reads each listed channel from `ctx.state.channels`, formats the non-empty string values as `<documents>` XML, and prepends the block to the last user message content — leaving the system prompt untouched so prompt caching works. The UI adds a list of text inputs to the LLM node config panel.

**Tech Stack:** TypeScript, Zod, Vitest, TanStack Form, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-05-25-rag-context-injection-design.md`

---

## File Map

| File | Change |
|---|---|
| `libs/agent-studio/src/types/nodes.ts` | Add `contextChannels?: string[]` to `LlmNodeConfig` |
| `libs/agent-studio/src/registry/schemas/llm.ts` | Add `contextChannels: z.array(z.string()).optional()` |
| `libs/agent-studio/src/execution/node-executors/llm-executor.ts` | Injection logic before `streamChat` call |
| `libs/agent-studio/src/execution/node-executors/node-executors.test.ts` | 4 new test cases for injection |
| `apps/web-ui/components/agents/config/llm-node-form.tsx` | Context Channels UI section |

---

## Task 1: Types + Zod Schema

**Files:**
- Modify: `libs/agent-studio/src/types/nodes.ts`
- Modify: `libs/agent-studio/src/registry/schemas/llm.ts`

- [ ] **Step 1: Add `contextChannels` to `LlmNodeConfig`**

Open `libs/agent-studio/src/types/nodes.ts`. Find `LlmNodeConfig` (around line 21). Replace the interface with:

```typescript
export interface LlmNodeConfig {
  type: 'llm';
  model: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** Tool names wired into this node */
  tools?: string[];
  /** Channel names whose string values are injected as RAG context into the last user message */
  contextChannels?: string[];
}
```

- [ ] **Step 2: Add `contextChannels` to the Zod schema**

Open `libs/agent-studio/src/registry/schemas/llm.ts`. Replace the entire file contents with:

```typescript
import { z } from 'zod';

export const llmNodeSchema = z.object({
  type: z.literal('llm'),
  model: z.string().min(1, 'Model is required'),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  tools: z.array(z.string()).optional(),
  contextChannels: z.array(z.string()).optional(),
});
```

- [ ] **Step 3: Run TypeScript check to confirm no type errors**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
bunx tsc --noEmit -p libs/agent-studio/tsconfig.json
```

Expected: exits with no errors. If there are errors, the LlmNodeConfig interface or schema is inconsistent — fix before proceeding.

- [ ] **Step 4: Commit**

```bash
git add libs/agent-studio/src/types/nodes.ts libs/agent-studio/src/registry/schemas/llm.ts
git commit -m "feat(rag): add contextChannels field to LlmNodeConfig and Zod schema"
```

---

## Task 2: LLM Executor — Context Injection (TDD)

**Files:**
- Modify: `libs/agent-studio/src/execution/node-executors/node-executors.test.ts`
- Modify: `libs/agent-studio/src/execution/node-executors/llm-executor.ts`

### Step 2a — Write the failing tests

- [ ] **Step 1: Add four new test cases to the `LlmNodeExecutor` describe block**

Open `libs/agent-studio/src/execution/node-executors/node-executors.test.ts`. Append the following four tests inside the existing `describe('LlmNodeExecutor', ...)` block, after the `'propagates provider errors'` test (line 271):

```typescript
  it('prepends context channel content to last user message as XML', async () => {
    const chunks = ['answer'];
    const mockProvider = {
      streamChat: vi.fn().mockReturnValue({
        textStream: (async function* () { for (const c of chunks) yield c; })(),
      }),
    };

    const ctx = createMockContext({
      state: createMockState({
        messages: [{ role: 'user', content: 'What is the policy?' }],
        channels: { kb_results: 'Policy document text here.' },
      }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3', contextChannels: ['kb_results'] },
      services: { llmProvider: vi.fn().mockResolvedValue(mockProvider), prisma: {} },
      emit: vi.fn(),
    });

    await executor.execute(ctx);

    expect(mockProvider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: 'user',
            content:
              '<documents>\n<document index="1">\nPolicy document text here.\n</document>\n</documents>\n\nWhat is the policy?',
          },
        ],
        system: undefined,
      }),
    );
  });

  it('skips injection when listed channel value is empty', async () => {
    const chunks = ['answer'];
    const mockProvider = {
      streamChat: vi.fn().mockReturnValue({
        textStream: (async function* () { for (const c of chunks) yield c; })(),
      }),
    };

    const ctx = createMockContext({
      state: createMockState({
        messages: [{ role: 'user', content: 'Hello' }],
        channels: { kb_results: '' },
      }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3', contextChannels: ['kb_results'] },
      services: { llmProvider: vi.fn().mockResolvedValue(mockProvider), prisma: {} },
      emit: vi.fn(),
    });

    await executor.execute(ctx);

    expect(mockProvider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    );
  });

  it('skips injection when no user message exists in messages array', async () => {
    const chunks = ['answer'];
    const mockProvider = {
      streamChat: vi.fn().mockReturnValue({
        textStream: (async function* () { for (const c of chunks) yield c; })(),
      }),
    };

    const ctx = createMockContext({
      state: createMockState({
        messages: [],
        channels: { kb_results: 'some context' },
      }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3', contextChannels: ['kb_results'] },
      services: { llmProvider: vi.fn().mockResolvedValue(mockProvider), prisma: {} },
      emit: vi.fn(),
    });

    await executor.execute(ctx);

    expect(mockProvider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [] }),
    );
  });

  it('injects multiple channels as separate document blocks', async () => {
    const chunks = ['answer'];
    const mockProvider = {
      streamChat: vi.fn().mockReturnValue({
        textStream: (async function* () { for (const c of chunks) yield c; })(),
      }),
    };

    const ctx = createMockContext({
      state: createMockState({
        messages: [{ role: 'user', content: 'Summarise.' }],
        channels: { kb_results: 'KB content.', http_data: 'HTTP content.' },
      }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: {
        type: 'llm',
        model: 'claude-3',
        contextChannels: ['kb_results', 'http_data'],
      },
      services: { llmProvider: vi.fn().mockResolvedValue(mockProvider), prisma: {} },
      emit: vi.fn(),
    });

    await executor.execute(ctx);

    expect(mockProvider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: 'user',
            content:
              '<documents>\n<document index="1">\nKB content.\n</document>\n<document index="2">\nHTTP content.\n</document>\n</documents>\n\nSummarise.',
          },
        ],
      }),
    );
  });
```

- [ ] **Step 2: Run the tests — confirm all four new tests FAIL**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
bunx vitest run libs/agent-studio/src/execution/node-executors/node-executors.test.ts
```

Expected output: the four new tests fail (something like "expected called with ... but was called with ..."), and the existing two LlmNodeExecutor tests still pass.

If the new tests are somehow passing already, the executor already has injection logic — stop and investigate before proceeding.

### Step 2b — Implement the injection

- [ ] **Step 3: Replace `llm-executor.ts` with the implementation below**

Open `libs/agent-studio/src/execution/node-executors/llm-executor.ts`. Replace the entire file:

```typescript
import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { LlmNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:llm-executor');

export class LlmNodeExecutor implements NodeExecutor {
  type = 'llm';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as LlmNodeConfig;
    const startedAt = new Date().toISOString();

    try {
      const provider = await ctx.services.llmProvider(undefined, config.model);

      let messages = ctx.state.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const contextChannels = config.contextChannels ?? [];
      const channelContents = contextChannels
        .map((ch) => ({ ch, content: ctx.state.channels[ch] }))
        .filter(
          (e): e is { ch: string; content: string } =>
            typeof e.content === 'string' && e.content.trim().length > 0,
        );

      if (channelContents.length > 0) {
        const lastUserIdx = messages.reduce<number>(
          (found, m, i) => (m.role === 'user' ? i : found),
          -1,
        );

        if (lastUserIdx !== -1) {
          const docBlock = channelContents
            .map((e, i) => `<document index="${i + 1}">\n${e.content}\n</document>`)
            .join('\n');
          const xmlBlock = `<documents>\n${docBlock}\n</documents>`;

          messages = [
            ...messages.slice(0, lastUserIdx),
            { ...messages[lastUserIdx], content: `${xmlBlock}\n\n${messages[lastUserIdx].content}` },
            ...messages.slice(lastUserIdx + 1),
          ];

          logger.debug(
            { nodeId: ctx.node.id, channels: contextChannels, docCount: channelContents.length },
            'injected context channels into last user message',
          );
        } else {
          logger.warn(
            { nodeId: ctx.node.id, channels: contextChannels },
            'contextChannels configured but no user message found to inject into — skipping',
          );
        }
      }

      const streamResult = provider.streamChat({
        messages,
        system: config.systemPrompt,
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
      });

      let fullText = '';
      for await (const chunk of streamResult.textStream) {
        fullText += chunk;
        ctx.emit({ type: 'text_delta', nodeId: ctx.node.id, delta: chunk });
      }

      logger.info(
        { nodeId: ctx.node.id, model: config.model, responseLength: fullText.length },
        'llm execution completed',
      );

      return {
        stateUpdates: { response: fullText },
        next: null,
        output: fullText,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'llm',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { messageCount: messages.length, model: config.model },
          output: { responseLength: fullText.length },
        },
      };
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'llm execution failed');
      throw error;
    }
  }
}
```

- [ ] **Step 4: Run all executor tests — confirm all six LlmNodeExecutor tests pass**

```bash
bunx vitest run libs/agent-studio/src/execution/node-executors/node-executors.test.ts
```

Expected: all tests in the file pass (2 original + 4 new). If any fail, check the `xmlBlock` construction and the `reduce` for `lastUserIdx`.

- [ ] **Step 5: Run the full agent-studio test suite — confirm no regressions**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
bunx vitest run --project libs/agent-studio
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add libs/agent-studio/src/execution/node-executors/llm-executor.ts \
        libs/agent-studio/src/execution/node-executors/node-executors.test.ts
git commit -m "feat(rag): inject contextChannels into last user message in LLM executor"
```

---

## Task 3: UI — Context Channels Form Section

**Files:**
- Modify: `apps/web-ui/components/agents/config/llm-node-form.tsx`

The existing form uses `@tanstack/react-form` with `handleBlur` to save on blur. This task adds a `contextChannels` string-array field below Max Tokens, following the same add/remove row pattern used in `parallel-node-form.tsx`.

- [ ] **Step 1: Replace `llm-node-form.tsx` with the updated version below**

Open `apps/web-ui/components/agents/config/llm-node-form.tsx`. Replace the entire file:

```typescript
'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { ProviderModelSelect } from '@/components/llm-providers/provider-model-select';
import type { LlmNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  model: z.string().min(1, 'Model is required'),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  contextChannels: z.array(z.string()).optional(),
});

type LlmFormValues = z.infer<typeof schema>;

interface LlmNodeFormProps {
  config: LlmNodeConfig;
  onChange: (config: LlmNodeConfig) => void;
}

export function LlmNodeForm({ config, onChange }: LlmNodeFormProps) {
  const form = useForm({
    defaultValues: {
      model: config.model ?? '',
      systemPrompt: config.systemPrompt ?? '',
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens,
      contextChannels: config.contextChannels ?? [],
    } as LlmFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'llm',
        model: value.model,
        systemPrompt: value.systemPrompt || undefined,
        temperature: value.temperature,
        maxTokens: value.maxTokens || undefined,
        contextChannels: value.contextChannels?.filter(Boolean).length
          ? value.contextChannels.filter(Boolean)
          : undefined,
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
      <form.Field name="model">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Model</Label>
            <ProviderModelSelect
              capability="chat"
              value={field.state.value ?? ''}
              onChange={(v) => { field.handleChange(v); handleBlur(); }}
              placeholder="Select a model"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="systemPrompt">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>System Prompt</Label>
            <Textarea
              id={field.name}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="You are a helpful assistant..."
              rows={4}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="temperature">
        {(field) => (
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Temperature</Label>
              <span className="text-xs text-muted-foreground">{field.state.value ?? 0.7}</span>
            </div>
            <Slider
              min={0}
              max={2}
              step={0.1}
              value={[field.state.value ?? 0.7]}
              onValueChange={(vals) => {
                const v = Array.isArray(vals) ? vals[0] : (vals as number);
                field.handleChange(v);
                handleBlur();
              }}
            />
          </div>
        )}
      </form.Field>

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
              placeholder="Leave blank for default"
            />
          </div>
        )}
      </form.Field>

      <form.Field name="contextChannels">
        {(field) => {
          const channels = (field.state.value ?? []) as string[];
          return (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label>Context Channels</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    form.setFieldValue('contextChannels', [...channels, '']);
                    handleBlur();
                  }}
                >
                  + Add
                </Button>
              </div>
              {channels.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Add the outputChannel name from an upstream KB, HTTP, or Code node (e.g.{' '}
                  <span className="font-mono">kb_results</span>).
                </p>
              ) : (
                channels.map((ch, idx) => (
                  <div key={idx} className="flex gap-1.5">
                    <Input
                      value={ch}
                      onChange={(e) => {
                        const next = [...channels];
                        next[idx] = e.target.value;
                        form.setFieldValue('contextChannels', next);
                      }}
                      onBlur={() => handleBlur()}
                      placeholder="e.g. kb_results"
                      className="flex-1 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 px-0 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        form.setFieldValue(
                          'contextChannels',
                          channels.filter((_, i) => i !== idx),
                        );
                        handleBlur();
                      }}
                    >
                      ×
                    </Button>
                  </div>
                ))
              )}
            </div>
          );
        }}
      </form.Field>
    </form>
  );
}
```

- [ ] **Step 2: Run TypeScript check on web-ui**

```bash
bunx tsc --noEmit -p apps/web-ui/tsconfig.json
```

Expected: no type errors. If there is an error about `contextChannels` not existing on `LlmNodeConfig`, confirm Task 1 was committed and the path alias `@chatbot/agent-studio` is resolving correctly.

- [ ] **Step 3: Start the dev server and manually verify the UI**

```bash
bun run dev
```

Open the canvas, drop an LLM node, open its config panel. Verify:
- The "Context Channels" section appears below Max Tokens
- Clicking "+ Add" adds an empty text input row
- Typing `kb_results` into the input and clicking away saves the value (check the node config in the canvas store or re-open the panel)
- Clicking × removes the row
- An LLM node with no channels configured behaves identically to before (the empty-state helper text is shown)

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/components/agents/config/llm-node-form.tsx
git commit -m "feat(rag): add Context Channels UI section to LLM node config form"
```

---

## Task 4: Dev Change Record + Final Test Run

**Files:**
- Create: `docs/dev/changes/2026-05-25-rag-context-injection.md`

- [ ] **Step 1: Create the change record**

Create `docs/dev/changes/2026-05-25-rag-context-injection.md`:

```markdown
# RAG context injection via contextChannels on LLM node

**Date:** 2026-05-25
**Type:** feature
**Files:**
- `libs/agent-studio/src/types/nodes.ts`
- `libs/agent-studio/src/registry/schemas/llm.ts`
- `libs/agent-studio/src/execution/node-executors/llm-executor.ts`
- `apps/web-ui/components/agents/config/llm-node-form.tsx`

## What changed
`LlmNodeConfig` gains an optional `contextChannels: string[]` field. The LLM executor now reads each listed channel from `ctx.state.channels`, formats non-empty string values as `<documents>` XML, and prepends the block to the last user message before the API call. The system prompt is untouched. The LLM node config form shows a "Context Channels" section with add/remove rows.

## Why
KB nodes write retrieved text to `channels['kb_results']` but the LLM executor only read `ctx.state.messages`. Retrieved context was never seen by the LLM — RAG was wired in the graph but produced zero benefit.

## Research
- LangGraph canonical RAG: retrieve node writes to `state.retrieved_docs`, generate node reads it and builds prompt. Source-of-truth is the typed state dict — nodes are decoupled, the generate node declares what it reads.
- Injection placement: all three providers (Anthropic, OpenAI, Google) recommend documents in the user turn, not system prompt. Keeps system prompt stable for prompt caching (75–90% cost discount at scale). Documents in user turn are treated as data, not instructions — reduces prompt injection risk from KB content.
- `<documents>` XML format: Anthropic explicitly recommends it; OpenAI and Gemini models handle it correctly. Degrades gracefully on small/open-source models (text still injected, delimiter semantics may not be parsed).
- Works across all providers: injection is plain string manipulation on the messages array before the SDK call. Provider-specific prompt template formatting is handled by the serving layer (Ollama, vLLM, Bedrock, etc.), invisible to our executor.

## Watch for
- Channel values are typed as `unknown`. The executor guards with `typeof === 'string'`. Non-string values (objects, arrays from Code nodes) are silently skipped. A future enhancement could JSON-serialise them.
- Injection is constructed fresh on every LLM node execution — it does NOT persist into `state.messages`. This is intentional: KB retrieval should be re-run and re-injected per turn.
- If a future node writes per-chunk structured output to a channel (array of strings), a richer format (one `<document>` per chunk) would be a follow-on spec.
```

- [ ] **Step 2: Run the full test suite one final time**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
bun run test
```

Expected: all tests pass. If any test is red, fix before committing.

- [ ] **Step 3: Commit**

```bash
git add docs/dev/changes/2026-05-25-rag-context-injection.md
git commit -m "docs: add change record for RAG context injection feature"
```

---

## End-to-End Test Scenario

After all tasks are complete, verify the full RAG flow manually:

1. Open the canvas and build this graph:
   ```
   Input → KB Node → LLM Node → Output
   ```
2. KB node config: leave `knowledgeBaseIds` empty (auto-discover from agent attachments), `outputChannel: kb_results`
3. LLM node config: set `contextChannels: ['kb_results']`, set a system prompt like `"Answer using only the provided context."`
4. Attach a knowledge base to the agent (agent settings page)
5. Open the playground and send a question whose answer is in the KB
6. Confirm the LLM response references content from the knowledge base, not hallucinated memory

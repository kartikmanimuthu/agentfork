# Router Natural Language Conditions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `mode` toggle to the Router node so users can write plain English conditions instead of JS expressions; at runtime the executor calls the tenant's LLM to classify which condition matches.

**Architecture:** Add `mode: 'expression' | 'natural_language'` to the router schema and config type. The executor checks the mode and either runs the existing `new Function()` JS eval (expression mode) or calls `ctx.services.llmProvider()` with a classification prompt and parses the returned index (NL mode). The UI adds a single toggle at the top of the router config panel — no canvas wiring required.

**Tech Stack:** TypeScript, Zod, TanStack Form, Vitest, shadcn/ui Switch component

---

## Bug Fix + Extension (2026-05-26)

After the initial implementation, two bugs were found and fixed, plus a model-selector feature was added:

1. **NLP prompt bug**: The classifier prompt buried the user's message as a JSON array in the channels dump (`messages: [{"role":"user","content":"..."}]`). At low temperature, the LLM often returned -1 (no match). Fixed by explicitly extracting the last user message and presenting it as `User's message: "..."`.

2. **Default provider bug**: The router called `llmProvider()` with no model argument, hitting the tenant's default Bedrock provider. If that model is legacy/deprecated, the call returns an empty response → `NaN` → silent fallback to default target every time. Confirmed in logs: `"Access denied. This Model is marked by provider as Legacy"`.

3. **Classifier model dropdown**: Added `classifierModel?: string` to `RouterNodeConfig` and the Zod schema. The executor now calls `llmProvider(undefined, config.classifierModel)` when set. The UI shows a `ProviderModelSelect` dropdown (same component as LLM nodes) instead of a text input — only models from configured providers can be selected.

See `docs/dev/changes/2026-05-26-router-nlp-classifier-fix.md` for full details.

---

## Files

| Action | Path |
|---|---|
| Modify | `libs/agent-studio/src/registry/schemas/router.ts` |
| Modify | `libs/agent-studio/src/types/nodes.ts` |
| Modify | `libs/agent-studio/src/execution/node-executors/router-executor.ts` |
| Modify | `libs/agent-studio/src/execution/node-executors/node-executors.test.ts` |
| Modify | `apps/web-ui/components/agents/config/router-node-form.tsx` |

---

## Task 1: Add `mode` to router schema and types

**Files:**
- Modify: `libs/agent-studio/src/registry/schemas/router.ts`
- Modify: `libs/agent-studio/src/types/nodes.ts`

- [ ] **Step 1: Update the Zod schema**

Replace the contents of `libs/agent-studio/src/registry/schemas/router.ts`:

```typescript
import { z } from 'zod';

export const routerNodeSchema = z.object({
  type: z.literal('router'),
  mode: z.enum(['expression', 'natural_language']).default('expression'),
  conditions: z
    .array(
      z.object({
        condition: z.string().min(1, 'Condition is required'),
        target: z.string().min(1, 'Target node id is required'),
      })
    )
    .min(1, 'At least one condition is required'),
  defaultTarget: z.string().optional(),
});
```

- [ ] **Step 2: Update the TypeScript interface**

In `libs/agent-studio/src/types/nodes.ts`, find `RouterNodeConfig` and add `mode`:

```typescript
export interface RouterNodeConfig {
  type: 'router';
  mode?: 'expression' | 'natural_language';
  conditions: Array<{
    /** Boolean JS expression (expression mode) or plain English (natural_language mode) */
    condition: string;
    target: string;
  }>;
  defaultTarget?: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add libs/agent-studio/src/registry/schemas/router.ts libs/agent-studio/src/types/nodes.ts
git commit -m "feat(router): add mode field to RouterNodeConfig schema"
```

---

## Task 2: Write failing tests for NL mode executor

**Files:**
- Modify: `libs/agent-studio/src/execution/node-executors/node-executors.test.ts`

- [ ] **Step 1: Add NL mode tests**

In `node-executors.test.ts`, after the existing `RouterNodeExecutor` describe block, add:

```typescript
describe('RouterNodeExecutor — natural_language mode', () => {
  const executor = new RouterNodeExecutor();

  function makeNlContext(conditions: Array<{ condition: string; target: string }>, llmResponse: string) {
    const mockStreamChat = vi.fn().mockReturnValue({
      textStream: (async function* () { yield llmResponse; })(),
    });
    return createMockContext({
      node: createMockNode({ id: 'router-nl', type: 'router', label: 'NL Router' }),
      config: {
        type: 'router',
        mode: 'natural_language',
        conditions,
      },
      services: {
        llmProvider: vi.fn().mockResolvedValue({ streamChat: mockStreamChat }),
        prisma: {},
      },
    });
  }

  it('calls llmProvider and routes to the matched condition', async () => {
    const ctx = makeNlContext(
      [
        { condition: 'user is asking about billing', target: 'billing-node' },
        { condition: 'user wants a refund', target: 'refund-node' },
      ],
      '0'
    );
    const result = await executor.execute(ctx);
    expect(result.next).toEqual(['billing-node']);
  });

  it('routes to second condition when LLM returns index 1', async () => {
    const ctx = makeNlContext(
      [
        { condition: 'user is asking about billing', target: 'billing-node' },
        { condition: 'user wants a refund', target: 'refund-node' },
      ],
      '1'
    );
    const result = await executor.execute(ctx);
    expect(result.next).toEqual(['refund-node']);
  });

  it('falls back to defaultTarget when LLM returns -1', async () => {
    const ctx = {
      ...makeNlContext(
        [{ condition: 'user is asking about billing', target: 'billing-node' }],
        '-1'
      ),
      config: {
        type: 'router' as const,
        mode: 'natural_language' as const,
        conditions: [{ condition: 'user is asking about billing', target: 'billing-node' }],
        defaultTarget: 'fallback-node',
      },
    };
    const result = await executor.execute(ctx);
    expect(result.next).toEqual(['fallback-node']);
  });

  it('throws when LLM returns -1 and no defaultTarget', async () => {
    const ctx = makeNlContext(
      [{ condition: 'user is asking about billing', target: 'billing-node' }],
      '-1'
    );
    await expect(executor.execute(ctx)).rejects.toThrow('no condition matched');
  });

  it('includes channel state in the classification prompt', async () => {
    const mockStreamChat = vi.fn().mockReturnValue({
      textStream: (async function* () { yield '0'; })(),
    });
    const llmProvider = vi.fn().mockResolvedValue({ streamChat: mockStreamChat });
    const ctx = createMockContext({
      state: createMockState({ channels: { query: 'I need a refund' } }),
      node: createMockNode({ id: 'router-nl', type: 'router', label: 'NL Router' }),
      config: {
        type: 'router',
        mode: 'natural_language',
        conditions: [{ condition: 'user wants a refund', target: 'refund-node' }],
      },
      services: { llmProvider, prisma: {} },
    });
    await executor.execute(ctx);
    const callArgs = mockStreamChat.mock.calls[0][0];
    // The prompt should include the channel value
    const promptText = JSON.stringify(callArgs.messages);
    expect(promptText).toContain('I need a refund');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
bunx vitest run libs/agent-studio/src/execution/node-executors/node-executors.test.ts
```

Expected: tests in `RouterNodeExecutor — natural_language mode` fail because the executor doesn't support NL mode yet.

---

## Task 3: Implement NL mode in the router executor

**Files:**
- Modify: `libs/agent-studio/src/execution/node-executors/router-executor.ts`

- [ ] **Step 1: Replace the executor implementation**

```typescript
import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { RouterNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:router-executor');

export class RouterNodeExecutor implements NodeExecutor {
  type = 'router';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as RouterNodeConfig;
    const startedAt = new Date().toISOString();

    const mode = config.mode ?? 'expression';
    const matchedTarget = mode === 'natural_language'
      ? await this.evaluateNaturalLanguage(config, ctx)
      : this.evaluateExpressions(config, ctx);

    if (!matchedTarget) {
      const error = `router node "${ctx.node.id}": no condition matched and no default target`;
      logger.error({ nodeId: ctx.node.id, mode }, error);
      throw new Error(error);
    }

    logger.info({ nodeId: ctx.node.id, matchedTarget, mode }, 'router condition matched');

    return {
      stateUpdates: {},
      next: [matchedTarget],
      trace: {
        nodeId: ctx.node.id,
        nodeType: 'router',
        nodeLabel: ctx.node.label,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        input: { conditionCount: config.conditions.length, mode },
        output: { matchedTarget },
      },
    };
  }

  private evaluateExpressions(
    config: RouterNodeConfig,
    ctx: NodeExecutionContext,
  ): string | null {
    for (const { condition, target } of config.conditions) {
      if (this.evalExpression(condition, ctx.state.channels)) {
        return target;
      }
    }
    return config.defaultTarget ?? null;
  }

  private evalExpression(expression: string, channels: Record<string, unknown>): boolean {
    try {
      const fn = new Function(...Object.keys(channels), `return Boolean(${expression})`);
      return fn(...Object.values(channels));
    } catch (error) {
      logger.warn({ expression, error }, 'condition evaluation failed');
      return false;
    }
  }

  private async evaluateNaturalLanguage(
    config: RouterNodeConfig,
    ctx: NodeExecutionContext,
  ): Promise<string | null> {
    const provider = await ctx.services.llmProvider();

    const channelSummary = Object.entries(ctx.state.channels)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join('\n');

    const conditionList = config.conditions
      .map((c, i) => `${i}: ${c.condition}`)
      .join('\n');

    const prompt = `You are a routing classifier. Based on the current context, determine which routing condition (if any) best matches.

Current context:
${channelSummary || '(no channel data)'}

Routing conditions:
${conditionList}

Respond with ONLY a single integer:
- The 0-based index of the best matching condition
- Or -1 if none of the conditions match

No explanation. Just the number.`;

    const streamResult = provider.streamChat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      maxOutputTokens: 10,
    });

    let response = '';
    for await (const chunk of streamResult.textStream) {
      response += chunk;
    }

    const index = parseInt(response.trim(), 10);

    logger.info(
      { nodeId: ctx.node.id, response: response.trim(), parsedIndex: index },
      'NL router LLM response',
    );

    if (isNaN(index) || index < 0) {
      return config.defaultTarget ?? null;
    }

    const matched = config.conditions[index];
    return matched?.target ?? config.defaultTarget ?? null;
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
bunx vitest run libs/agent-studio/src/execution/node-executors/node-executors.test.ts
```

Expected: all tests PASS including the new NL mode tests.

- [ ] **Step 3: Commit**

```bash
git add libs/agent-studio/src/execution/node-executors/router-executor.ts \
        libs/agent-studio/src/execution/node-executors/node-executors.test.ts
git commit -m "feat(router): add natural language condition evaluation via LLM"
```

---

## Task 4: Add mode toggle to the router UI form

**Files:**
- Modify: `apps/web-ui/components/agents/config/router-node-form.tsx`

- [ ] **Step 1: Replace the form implementation**

```typescript
'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2 } from 'lucide-react';
import { NodePicker } from './node-picker';
import type { NodeOption } from './node-picker';
import type { RouterNodeConfig } from '@chatbot/agent-studio';

const conditionSchema = z.object({
  condition: z.string().min(1, 'Condition is required'),
  target: z.string().min(1, 'Target node is required'),
});

const schema = z.object({
  mode: z.enum(['expression', 'natural_language']),
  conditions: z.array(conditionSchema).min(1, 'At least one condition is required'),
  defaultTarget: z.string().optional(),
});

type RouterFormValues = z.infer<typeof schema>;

interface RouterNodeFormProps {
  config: RouterNodeConfig;
  onChange: (config: RouterNodeConfig) => void;
  allNodes: NodeOption[];
}

export function RouterNodeForm({ config, onChange, allNodes }: RouterNodeFormProps) {
  const form = useForm({
    defaultValues: {
      mode: config.mode ?? 'expression',
      conditions: config.conditions ?? [],
      defaultTarget: config.defaultTarget ?? '',
    } as RouterFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'router',
        mode: value.mode,
        conditions: value.conditions,
        defaultTarget: value.defaultTarget || undefined,
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
      {/* Mode toggle */}
      <form.Field name="mode">
        {(field) => (
          <div className="flex items-center justify-between">
            <div className="grid gap-0.5">
              <Label>Natural Language Mode</Label>
              <p className="text-xs text-muted-foreground">
                {field.state.value === 'natural_language'
                  ? 'Write conditions in plain English — LLM classifies at runtime'
                  : 'Write conditions as JS expressions (e.g. score > 0.8)'}
              </p>
            </div>
            <Switch
              checked={field.state.value === 'natural_language'}
              onCheckedChange={(checked) => {
                field.handleChange(checked ? 'natural_language' : 'expression');
                handleBlur();
              }}
            />
          </div>
        )}
      </form.Field>

      {/* Conditions */}
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label>Conditions</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              const current = form.getFieldValue('conditions') as RouterFormValues['conditions'];
              form.setFieldValue('conditions', [...current, { condition: '', target: '' }]);
            }}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        </div>

        <form.Field name="conditions" mode="array">
          {(field) => (
            <div className="space-y-2">
              {(field.state.value as RouterFormValues['conditions']).map((_, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="flex-1 grid gap-1">
                    <form.Field name={`conditions[${i}].condition`}>
                      {(condField) => (
                        <form.Subscribe selector={(s) => s.values.mode}>
                          {(mode) => (
                            <Input
                              value={condField.state.value as string}
                              onChange={(e) => condField.handleChange(e.target.value)}
                              onBlur={() => { condField.handleBlur(); handleBlur(); }}
                              placeholder={
                                mode === 'natural_language'
                                  ? 'e.g. user is asking about billing'
                                  : 'e.g. score > 0.8'
                              }
                              className="h-8 text-xs"
                              aria-label={`Condition ${i + 1}`}
                            />
                          )}
                        </form.Subscribe>
                      )}
                    </form.Field>
                    <form.Field name={`conditions[${i}].target`}>
                      {(targetField) => (
                        <NodePicker
                          nodes={allNodes}
                          value={targetField.state.value as string}
                          onChange={(id) => {
                            targetField.handleChange(id);
                            handleBlur();
                          }}
                          placeholder="Target node…"
                          className="h-8 text-xs"
                        />
                      )}
                    </form.Field>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive shrink-0 mt-0.5"
                    onClick={() => {
                      const current = form.getFieldValue('conditions') as RouterFormValues['conditions'];
                      form.setFieldValue('conditions', current.filter((_: unknown, j: number) => j !== i));
                      handleBlur();
                    }}
                    aria-label={`Remove condition ${i + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {(field.state.value as RouterFormValues['conditions']).length === 0 && (
                <p className="text-xs text-muted-foreground italic">No conditions yet.</p>
              )}
            </div>
          )}
        </form.Field>
      </div>

      {/* Default target */}
      <form.Field name="defaultTarget">
        {(field) => (
          <div className="grid gap-1.5">
            <Label>Default Target (optional)</Label>
            <NodePicker
              nodes={allNodes}
              value={field.state.value as string ?? ''}
              onChange={(id) => {
                field.handleChange(id);
                handleBlur();
              }}
              placeholder="Fallback node…"
            />
          </div>
        )}
      </form.Field>
    </form>
  );
}
```

- [ ] **Step 2: Verify Switch component is available**

```bash
ls apps/web-ui/components/ui/switch.tsx
```

Expected: file exists. If not, run `bunx shadcn@latest add switch` from `apps/web-ui/`.

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/components/agents/config/router-node-form.tsx
git commit -m "feat(canvas): add natural language mode toggle to router node config form"
```

---

## Task 5: Manual verification

- [ ] **Step 1: Start workers and web-ui**

```bash
# Terminal 1
bun run dev:workers

# Terminal 2
bun run dev
```

- [ ] **Step 2: Test expression mode (existing behavior)**

1. Open the playground, create a graph with a Router node
2. Confirm the mode toggle defaults to off (Expression mode)
3. Add a condition `score > 0` pointing to a target node
4. Run a graph — router should follow the JS expression path as before

- [ ] **Step 3: Test natural language mode**

1. Toggle the router to Natural Language mode
2. The condition placeholder should change to `e.g. user is asking about billing`
3. Add condition: `user is asking a question` → target: some LLM node
4. Run the graph with a user message
5. Check worker logs — you should see `NL router LLM response` with a parsed index

- [ ] **Step 4: Commit docs**

```bash
git add docs/
git commit -m "docs: add change record for router natural language conditions"
```

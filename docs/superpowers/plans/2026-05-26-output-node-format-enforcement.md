# Output Node Format Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the three `format` modes (`text`, `json`, `stream`) in the output node executor, add logging, and add try/catch — currently `config.format` is captured in the trace but completely ignored.

**Architecture:** `formatContent()` is a private method on `OutputNodeExecutor` that switches on `config.format`. `text` coerces to string (existing behaviour). `json` always serializes with `JSON.stringify` and throws on circular references. `stream` produces the same string as `text` but also emits a `text_delta` event so the UI receives it progressively. The executor wraps the whole `execute()` body in try/catch (matching the llm-executor pattern) and logs on success and failure.

**Tech Stack:** TypeScript, Vitest, Pino logger

---

## Files

| Action | Path |
|---|---|
| Modify | `libs/agent-studio/src/execution/node-executors/output-executor.ts` |
| Modify | `libs/agent-studio/src/execution/node-executors/node-executors.test.ts` |

---

## Task 1: Write failing tests for output node format enforcement

**Files:**
- Modify: `libs/agent-studio/src/execution/node-executors/node-executors.test.ts`

- [ ] **Step 1: Add `OutputNodeExecutor` import**

At the top of `libs/agent-studio/src/execution/node-executors/node-executors.test.ts`, add to the existing imports:

```typescript
import { OutputNodeExecutor } from './output-executor';
```

- [ ] **Step 2: Add the test block at the end of the file**

```typescript
describe('OutputNodeExecutor', () => {
  const executor = new OutputNodeExecutor();

  function makeCtx(
    format: 'text' | 'json' | 'stream',
    channelValue: unknown,
  ) {
    const emit = vi.fn();
    const ctx = createMockContext({
      node: createMockNode({ id: 'out-1', type: 'output', label: 'Output' }),
      config: { type: 'output', responseChannel: 'response', format },
      state: createMockState({ channels: { response: channelValue } }),
      emit,
    });
    return { ctx, emit };
  }

  describe('text format', () => {
    it('returns string channel value as-is', async () => {
      const { ctx } = makeCtx('text', 'hello world');
      const result = await executor.execute(ctx);
      expect(result.output).toBe('hello world');
      expect(result.stateUpdates.__output).toBe('hello world');
    });

    it('coerces object channel value to JSON string', async () => {
      const { ctx } = makeCtx('text', { foo: 'bar' });
      const result = await executor.execute(ctx);
      expect(result.output).toBe('{"foo":"bar"}');
    });

    it('does not emit text_delta events', async () => {
      const { ctx, emit } = makeCtx('text', 'hello');
      await executor.execute(ctx);
      expect(emit).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'text_delta' }),
      );
    });
  });

  describe('json format', () => {
    it('serializes object channel value as JSON string', async () => {
      const { ctx } = makeCtx('json', { score: 0.9, label: 'positive' });
      const result = await executor.execute(ctx);
      expect(result.output).toBe(JSON.stringify({ score: 0.9, label: 'positive' }));
    });

    it('serializes a string channel value as JSON (quoted)', async () => {
      const { ctx } = makeCtx('json', 'hello');
      const result = await executor.execute(ctx);
      expect(result.output).toBe('"hello"');
    });

    it('serializes null/undefined channel value as JSON null', async () => {
      const { ctx } = makeCtx('json', undefined);
      const result = await executor.execute(ctx);
      expect(result.output).toBe('null');
    });

    it('throws when channel value is not JSON-serializable (circular ref)', async () => {
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;
      const { ctx } = makeCtx('json', circular);
      await expect(executor.execute(ctx)).rejects.toThrow();
    });
  });

  describe('stream format', () => {
    it('returns the string content as output', async () => {
      const { ctx } = makeCtx('stream', 'streamed content');
      const result = await executor.execute(ctx);
      expect(result.output).toBe('streamed content');
      expect(result.stateUpdates.__output).toBe('streamed content');
    });

    it('emits a text_delta event with the full content', async () => {
      const { ctx, emit } = makeCtx('stream', 'streamed content');
      await executor.execute(ctx);
      expect(emit).toHaveBeenCalledWith({
        type: 'text_delta',
        nodeId: 'out-1',
        delta: 'streamed content',
      });
    });

    it('coerces non-string channel value to string before emitting', async () => {
      const { ctx, emit } = makeCtx('stream', { answer: 42 });
      await executor.execute(ctx);
      expect(emit).toHaveBeenCalledWith({
        type: 'text_delta',
        nodeId: 'out-1',
        delta: '{"answer":42}',
      });
    });
  });

  describe('trace', () => {
    it('includes format and responseChannel in trace input', async () => {
      const { ctx } = makeCtx('text', 'hi');
      const result = await executor.execute(ctx);
      expect(result.trace.input).toEqual({ responseChannel: 'response', format: 'text' });
    });

    it('includes contentLength in trace output', async () => {
      const { ctx } = makeCtx('text', 'hi');
      const result = await executor.execute(ctx);
      expect(result.trace.output).toEqual({ contentLength: 2 });
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
nx test agent-studio 2>&1 | grep -E "✓|✗|FAIL|PASS|OutputNode" | head -30
```

Expected: The `OutputNodeExecutor` describe block fails. Existing 105 tests still pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
git add libs/agent-studio/src/execution/node-executors/node-executors.test.ts
git commit -m "test(output): add failing tests for format enforcement"
```

---

## Task 2: Implement format enforcement in output executor

**Files:**
- Modify: `libs/agent-studio/src/execution/node-executors/output-executor.ts`

- [ ] **Step 1: Replace the full contents of `output-executor.ts`**

```typescript
import { createLogger } from '@chatbot/shared';
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from '../types';
import type { OutputNodeConfig } from '../../types/nodes';

const logger = createLogger('agent-studio:output-executor');

export class OutputNodeExecutor implements NodeExecutor {
  type = 'output';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const config = ctx.config as OutputNodeConfig;
    const startedAt = new Date().toISOString();

    try {
      const channelValue = ctx.state.channels[config.responseChannel];
      const content = this.formatContent(config.format, channelValue, ctx);

      logger.info(
        { nodeId: ctx.node.id, format: config.format, contentLength: content.length },
        'output node executed',
      );

      return {
        stateUpdates: { __output: content },
        next: null,
        output: content,
        trace: {
          nodeId: ctx.node.id,
          nodeType: 'output',
          nodeLabel: ctx.node.label,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          input: { responseChannel: config.responseChannel, format: config.format },
          output: { contentLength: content.length },
        },
      };
    } catch (error) {
      logger.error({ nodeId: ctx.node.id, error }, 'output node execution failed');
      throw error;
    }
  }

  private formatContent(
    format: OutputNodeConfig['format'],
    channelValue: unknown,
    ctx: NodeExecutionContext,
  ): string {
    switch (format) {
      case 'json': {
        const serialized = JSON.stringify(channelValue ?? null);
        return serialized;
      }

      case 'stream': {
        const content = typeof channelValue === 'string'
          ? channelValue
          : JSON.stringify(channelValue ?? '');
        ctx.emit({ type: 'text_delta', nodeId: ctx.node.id, delta: content });
        return content;
      }

      case 'text':
      default:
        return typeof channelValue === 'string'
          ? channelValue
          : JSON.stringify(channelValue ?? '');
    }
  }
}
```

- [ ] **Step 2: Run all tests to verify they pass**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
nx test agent-studio 2>&1 | tail -15
```

Expected: All tests pass, including the new `OutputNodeExecutor` block (12 new tests + 105 existing = 117 total).

- [ ] **Step 3: Commit**

```bash
cd /Users/H2702/.superset/worktrees/chatbot/multi-tenant-saas-chatbot
git add libs/agent-studio/src/execution/node-executors/output-executor.ts
git commit -m "feat(output): enforce text/json/stream formats, add logging and try/catch"
```

---

## Self-Review

**Spec coverage:**
- `text` format — ✅ Task 2, `text`/`default` branch in `formatContent`, 3 tests in Task 1
- `json` format — ✅ Task 2, `json` branch, 4 tests (including circular ref throw)
- `stream` format — ✅ Task 2, `stream` branch emits `text_delta`, 3 tests
- logger unused — ✅ Fixed: `logger.info` on success, `logger.error` in catch
- no try/catch — ✅ Fixed: whole execute body wrapped

**Placeholder scan:** No TBDs, no "add error handling", all code blocks are complete.

**Type consistency:** `OutputNodeConfig['format']` used as parameter type in `formatContent` — matches the discriminated union in `nodes.ts` (`'text' | 'json' | 'stream'`). `ctx.node.id` referenced consistently.

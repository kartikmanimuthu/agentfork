# Enhanced Playground: Developer Console & Markdown Rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add markdown rendering, per-message observability metadata, and a developer console with Events/Raw/Trace/Metrics tabs to the playground module.

**Architecture:** Extend the existing playground page with a resizable split right panel (using the existing `react-resizable-panels` component). Enhance the SSE streaming protocol to emit structured execution events. Client-side hooks capture events and derive metrics for the console UI.

**Tech Stack:** React, Next.js App Router, react-resizable-panels (already installed), react-markdown + prism (already installed), AI SDK, SSE streaming, Tailwind CSS, shadcn/ui components.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web-ui/hooks/use-console.ts` | Console UI state: active tab, filters, selected message, derived events |
| `apps/web-ui/lib/playground/types.ts` | Shared TypeScript types for console events, metrics, cost |
| `apps/web-ui/lib/playground/cost.ts` | Cost calculation utility (model ID + tokens → USD) |
| `apps/web-ui/lib/playground/sanitize.ts` | Markdown content sanitizer (strip `<br>` tags, normalize) |
| `apps/web-ui/components/agents/playground/console.tsx` | Console container with tab navigation |
| `apps/web-ui/components/agents/playground/console-events.tsx` | Structured event log tab |
| `apps/web-ui/components/agents/playground/console-raw.tsx` | Raw protocol viewer tab |
| `apps/web-ui/components/agents/playground/console-trace.tsx` | Execution trace tree tab |
| `apps/web-ui/components/agents/playground/console-metrics.tsx` | Metrics dashboard tab |
| `apps/web-ui/components/agents/playground/message-metadata-bar.tsx` | Per-message footer with latency/tokens/model |
| `apps/web-ui/components/agents/playground/thinking-block.tsx` | Collapsible thinking display |

### Modified Files

| File | Change |
|------|--------|
| `apps/web-ui/hooks/use-playground.ts` | Capture SSE events, emit console events, track metrics |
| `apps/web-ui/components/chat/chat-messages.tsx` | Add message selection, metadata bar, thinking block |
| `apps/web-ui/components/chat/chat-bubble.tsx` | Add sanitization before markdown, selection styling |
| `apps/web-ui/app/(dashboard)/agents/[id]/playground/page.tsx` | Replace right sidebar with resizable split panel |
| `apps/web-ui/app/api/agents/[id]/playground/route.ts` | Emit enhanced SSE events with metadata |

---

## Task 1: Shared Types & Cost Utility

**Files:**
- Create: `apps/web-ui/lib/playground/types.ts`
- Create: `apps/web-ui/lib/playground/cost.ts`
- Create: `apps/web-ui/lib/playground/sanitize.ts`

- [ ] **Step 1: Create types file**

```typescript
// apps/web-ui/lib/playground/types.ts
export type EventSeverity = 'info' | 'warn' | 'error';

export interface ConsoleEvent {
  id: string;
  messageId: string;
  timestamp: number;
  relativeMs: number;
  severity: EventSeverity;
  type: string;
  data: Record<string, unknown>;
}

export interface MessageMetrics {
  messageId: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  ttftMs: number;
  durationMs: number;
  model: string;
  costEstimate: CostEstimate;
}

export interface CostEstimate {
  input: number;
  output: number;
  thinking: number;
  total: number;
}

export interface SessionMetrics {
  totalTokens: number;
  totalCost: number;
  messageCount: number;
  avgTokensPerMessage: number;
  avgLatencyMs: number;
  tokensByMessage: Array<{ messageId: string; input: number; output: number; thinking: number }>;
  latencyByMessage: Array<{ messageId: string; durationMs: number }>;
}

export interface RawData {
  request: { method: string; url: string; headers: Record<string, string>; body: unknown };
  response: { status: number; headers: Record<string, string>; ttfbMs?: number };
  sseStream: string[];
}

export interface ThinkingContent {
  text: string;
  tokens: number;
  durationMs: number;
}

export type ConsoleTab = 'events' | 'raw' | 'trace' | 'metrics';

export interface TraceNode {
  id: string;
  name: string;
  type: string;
  status: 'running' | 'completed' | 'failed';
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  children?: TraceNode[];
}
```

- [ ] **Step 2: Create cost calculation utility**

```typescript
// apps/web-ui/lib/playground/cost.ts
import type { CostEstimate } from './types';

interface ModelPricing {
  inputPer1k: number;
  outputPer1k: number;
  thinkingPer1k?: number;
}

const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'anthropic.claude-3-5-sonnet-20241022-v2:0': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'anthropic.claude-3-5-haiku-20241022-v1:0': { inputPer1k: 0.0008, outputPer1k: 0.004 },
  'anthropic.claude-3-opus-20240229-v1:0': { inputPer1k: 0.015, outputPer1k: 0.075 },
  'anthropic.claude-sonnet-4-20250514-v1:0': { inputPer1k: 0.003, outputPer1k: 0.015 },
};

const FALLBACK_PRICING: ModelPricing = { inputPer1k: 0.003, outputPer1k: 0.015 };

export function calculateCost(
  model: string,
  usage: { inputTokens: number; outputTokens: number; thinkingTokens?: number }
): CostEstimate {
  const pricing = DEFAULT_PRICING[model] ?? FALLBACK_PRICING;
  const input = (usage.inputTokens / 1000) * pricing.inputPer1k;
  const output = (usage.outputTokens / 1000) * pricing.outputPer1k;
  const thinking = usage.thinkingTokens
    ? (usage.thinkingTokens / 1000) * (pricing.thinkingPer1k ?? pricing.outputPer1k)
    : 0;
  return { input, output, thinking, total: input + output + thinking };
}
```

- [ ] **Step 3: Create markdown sanitizer**

```typescript
// apps/web-ui/lib/playground/sanitize.ts
export function sanitizeMarkdown(content: string): string {
  return content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/lib/playground/
git commit -m "feat(playground): add shared types, cost utility, and markdown sanitizer"
```

---

## Task 2: Fix Markdown Rendering in ChatBubble

**Files:**
- Modify: `apps/web-ui/components/chat/chat-bubble.tsx`

- [ ] **Step 1: Import sanitizer and apply to content**

In `apps/web-ui/components/chat/chat-bubble.tsx`, add the import and sanitize content before passing to ReactMarkdown:

```typescript
// Add import at top
import { sanitizeMarkdown } from '@/lib/playground/sanitize';
```

Then change line 172 from:
```typescript
                {content}
```
to:
```typescript
                {sanitizeMarkdown(content)}
```

- [ ] **Step 2: Verify markdown renders correctly**

Run: `bun run dev`
Navigate to playground, send a message that triggers markdown (tables, code blocks). Confirm `<br>` tags are converted to newlines and tables render properly.

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/components/chat/chat-bubble.tsx
git commit -m "fix(playground): sanitize HTML entities before markdown rendering"
```

---

## Task 3: Enhanced SSE Protocol in Playground API

**Files:**
- Modify: `apps/web-ui/app/api/agents/[id]/playground/route.ts`

- [ ] **Step 1: Add execution metadata events for simple agents**

In the POST handler, after `const result = streamChat(...)` (line 173), replace the return statement (line 196-200) with a custom SSE stream that wraps the AI SDK response and emits structured events:

```typescript
    // Simple agent execution — replace lines 173-200
    const startTime = Date.now();
    let ttftMs: number | undefined;

    const result = streamChat({
      provider,
      messages: coreMessages,
      model: effectiveModel,
      system: effectiveSystem,
      temperature: effectiveTemperature,
      maxOutputTokens: maxTokens ?? simpleConfig.maxTokens ?? 4096,
      ...(hasMcpTools ? { tools: mcpTools, maxSteps: 5 } : {}),
      onFinish: async ({ text, usage }) => {
        await mcpCleanup();
        const completedAt = new Date();
        await db.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: 'completed',
            output: { text, usage },
            completedAt,
          },
        });
        logger.info({ requestId, executionId: execution.id, usage }, 'Execution completed');
      },
    });

    const originalResponse = result.toUIMessageStreamResponse();
    const originalBody = originalResponse.body;
    if (!originalBody) {
      return originalResponse;
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let tokenBuffer = '';

    const enhancedStream = new ReadableStream({
      async start(controller) {
        // Emit execution_start
        controller.enqueue(encoder.encode(
          `event: execution_start\ndata: ${JSON.stringify({
            executionId: execution.id,
            model: effectiveModel ?? llmConfig?.chatModel ?? 'unknown',
            temperature: effectiveTemperature,
            maxTokens: maxTokens ?? simpleConfig.maxTokens ?? 4096,
            timestamp: startTime,
          })}\n\n`
        ));

        const reader = originalBody.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Track TTFT
            if (ttftMs === undefined) {
              ttftMs = Date.now() - startTime;
            }

            // Pass through original stream data
            controller.enqueue(value);
          }

          // Emit execution_end after stream completes
          const durationMs = Date.now() - startTime;
          const execRecord = await db.agentExecution.findUnique({ where: { id: execution.id } });
          const output = (execRecord?.output as Record<string, unknown>) ?? {};
          const usage = (output.usage as { promptTokens?: number; completionTokens?: number }) ?? {};

          controller.enqueue(encoder.encode(
            `event: execution_end\ndata: ${JSON.stringify({
              usage: {
                inputTokens: usage.promptTokens ?? 0,
                outputTokens: usage.completionTokens ?? 0,
                thinkingTokens: 0,
              },
              durationMs,
              ttftMs: ttftMs ?? durationMs,
              model: effectiveModel ?? llmConfig?.chatModel ?? 'unknown',
            })}\n\n`
          ));
        } catch (err) {
          controller.enqueue(encoder.encode(
            `event: error\ndata: ${JSON.stringify({
              code: 'STREAM_ERROR',
              message: err instanceof Error ? err.message : String(err),
              timestamp: Date.now(),
            })}\n\n`
          ));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(enhancedStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'x-execution-id': execution.id,
        'x-model-id': effectiveModel ?? llmConfig?.chatModel ?? 'unknown',
        'x-request-timestamp': String(startTime),
      },
    });
```

- [ ] **Step 2: Add execution metadata events for graph agents**

In the graph agent section (line 254 onwards), add `execution_start` and `execution_end` events around the existing graph execution:

```typescript
    // Graph agent execution — modify the stream start (inside ReadableStream.start)
    const startTime = Date.now();
    let ttftMs: number | undefined;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const sendEvent = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        // Emit execution_start
        sendEvent('execution_start', {
          executionId: execution.id,
          model: 'graph',
          temperature: 0,
          maxTokens: 0,
          timestamp: startTime,
        });

        try {
          await executor.execute(
            { nodes, edges },
            { messages: coreMessages },
            { executionId: execution.id, agentId: id, tenantId, userId },
            {
              onEvent: (event) => {
                if (event.type === 'text_delta' && ttftMs === undefined) {
                  ttftMs = Date.now() - startTime;
                }
                sendEvent(event.type, event);
                if (event.type === 'text_delta') {
                  fullText += event.delta;
                }
              },
            }
          );

          const durationMs = Date.now() - startTime;
          sendEvent('execution_end', {
            usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 },
            durationMs,
            ttftMs: ttftMs ?? durationMs,
            model: 'graph',
          });

          await db.agentExecution.update({
            where: { id: execution.id },
            data: {
              status: 'completed',
              output: { text: fullText },
              completedAt: new Date(),
            },
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          sendEvent('error', { code: 'EXECUTION_ERROR', message: errorMessage, timestamp: Date.now() });
          sendEvent('execution_end', {
            usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 },
            durationMs: Date.now() - startTime,
            ttftMs: ttftMs ?? Date.now() - startTime,
            model: 'graph',
            error: errorMessage,
          });
          await db.agentExecution.update({
            where: { id: execution.id },
            data: { status: 'failed', output: { error: errorMessage }, completedAt: new Date() },
          });
          logger.error({ executionId: execution.id, error: errorMessage }, 'Graph execution failed');
        } finally {
          controller.close();
        }
      },
    });
```

- [ ] **Step 3: Test the enhanced SSE stream**

Run: `bun run dev`
Use the playground to send a message. Open browser DevTools Network tab, check the SSE stream includes `execution_start` and `execution_end` events with proper metadata.

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/app/api/agents/[id]/playground/route.ts
git commit -m "feat(playground): emit execution_start/end SSE events with metadata"
```

---

## Task 4: Extend usePlayground Hook to Capture Console Events

**Files:**
- Modify: `apps/web-ui/hooks/use-playground.ts`

- [ ] **Step 1: Import types and add console event state**

Add imports and new state to the hook:

```typescript
// Add at top of file
import type { ConsoleEvent, MessageMetrics, RawData, ThinkingContent } from '@/lib/playground/types';
import { calculateCost } from '@/lib/playground/cost';
```

Add new state inside `usePlayground` function, after the existing state declarations:

```typescript
  const [consoleEvents, setConsoleEvents] = useState<ConsoleEvent[]>([]);
  const [messageMetrics, setMessageMetrics] = useState<Map<string, MessageMetrics>>(new Map());
  const [rawDataMap, setRawDataMap] = useState<Map<string, RawData>>(new Map());
  const [thinkingMap, setThinkingMap] = useState<Map<string, ThinkingContent>>(new Map());
```

- [ ] **Step 2: Create SSE event parser for graph agent streaming**

Replace the graph agent SSE parsing logic (inside `handleSend`, the `while (true)` loop starting around line 140) to also capture console events:

```typescript
      // Inside handleSend for graph agents, replace the SSE parsing section
      const requestStartTime = Date.now();
      let currentThinking = '';
      let thinkingStartTime = 0;

      // Store raw SSE lines
      const rawSseLines: string[] = [];

      // Store raw request data
      setRawDataMap((prev) => {
        const next = new Map(prev);
        next.set(assistantMessageId, {
          request: {
            method: 'POST',
            url: `/api/agents/${agentId}/playground`,
            headers: { 'Content-Type': 'application/json' },
            body: { messages: [...messages.map((m) => ({ role: m.role, content: m.parts.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map((p) => p.text).join('') })), { role: 'user', content }], agentVersionId: versionId, alias, ...overrides },
          },
          response: { status: res.status, headers: Object.fromEntries(res.headers.entries()) },
          sseStream: [],
        });
        return next;
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let eventType = '';
        for (const line of lines) {
          rawSseLines.push(line);

          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              const relativeMs = Date.now() - requestStartTime;

              // Capture as console event
              const consoleEvent: ConsoleEvent = {
                id: crypto.randomUUID(),
                messageId: assistantMessageId,
                timestamp: Date.now(),
                relativeMs,
                severity: eventType === 'error' ? 'error' : 'info',
                type: eventType,
                data,
              };
              setConsoleEvents((prev) => [...prev, consoleEvent]);

              // Handle specific event types
              if (eventType === 'text_delta' && data.delta) {
                fullText += data.delta;
                setMessages((prev) => {
                  const existing = prev.find((m) => m.id === assistantMessageId);
                  if (existing) {
                    return prev.map((m) =>
                      m.id === assistantMessageId
                        ? { ...m, parts: [{ type: 'text' as const, text: fullText }] }
                        : m
                    );
                  }
                  return [
                    ...prev,
                    {
                      id: assistantMessageId,
                      role: 'assistant' as const,
                      parts: [{ type: 'text' as const, text: fullText }],
                      executionId,
                    },
                  ];
                });
              } else if (eventType === 'thinking_start') {
                thinkingStartTime = Date.now();
                currentThinking = '';
              } else if (eventType === 'thinking_delta' && data.delta) {
                currentThinking += data.delta;
              } else if (eventType === 'thinking_end') {
                setThinkingMap((prev) => {
                  const next = new Map(prev);
                  next.set(assistantMessageId, {
                    text: currentThinking,
                    tokens: data.tokens ?? 0,
                    durationMs: data.durationMs ?? (Date.now() - thinkingStartTime),
                  });
                  return next;
                });
              } else if (eventType === 'execution_end') {
                const usage = data.usage ?? {};
                const metrics: MessageMetrics = {
                  messageId: assistantMessageId,
                  inputTokens: usage.inputTokens ?? 0,
                  outputTokens: usage.outputTokens ?? 0,
                  thinkingTokens: usage.thinkingTokens ?? 0,
                  totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.thinkingTokens ?? 0),
                  ttftMs: data.ttftMs ?? 0,
                  durationMs: data.durationMs ?? (Date.now() - requestStartTime),
                  model: data.model ?? 'unknown',
                  costEstimate: data.costEstimate ?? calculateCost(data.model ?? '', usage),
                };
                setMessageMetrics((prev) => {
                  const next = new Map(prev);
                  next.set(assistantMessageId, metrics);
                  return next;
                });
              }
            } catch {
              // skip malformed events
            }
            eventType = '';
          }
        }
      }

      // Update raw SSE data
      setRawDataMap((prev) => {
        const next = new Map(prev);
        const existing = next.get(assistantMessageId);
        if (existing) {
          next.set(assistantMessageId, { ...existing, sseStream: rawSseLines });
        }
        return next;
      });
```

- [ ] **Step 3: Add AI SDK stream event capture for simple agents**

For simple agents using `useChat`, we need to capture the `execution_start` and `execution_end` events. The AI SDK `useChat` hook doesn't expose raw SSE events directly, so we need to switch simple agents to use the same manual SSE approach as graph agents. Replace the simple agent path in `handleSend`:

```typescript
    if (agentType === 'simple') {
      // Switch to manual SSE to capture metadata events
      setIsGraphLoading(true);
      const assistantMessageId = crypto.randomUUID();
      const requestStartTime = Date.now();
      let fullText = '';
      const rawSseLines: string[] = [];

      try {
        const userMessage: PlaygroundMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          parts: [{ type: 'text' as const, text: content }],
        };
        setMessages((prev) => [...prev, userMessage]);

        const requestBody = {
          messages: [
            ...messages.map((m) => ({
              role: m.role,
              content: m.parts
                .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                .map((p) => p.text)
                .join(''),
            })),
            { role: 'user', content },
          ],
          agentVersionId: versionId,
          alias,
          systemPrompt: overrides.systemPrompt,
          model: overrides.model,
          temperature: overrides.temperature,
          maxTokens: overrides.maxTokens,
        };

        const res = await fetch(`/api/agents/${agentId}/playground`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) throw new Error('Failed to run agent');

        const executionId = res.headers.get('x-execution-id') ?? undefined;

        setRawDataMap((prev) => {
          const next = new Map(prev);
          next.set(assistantMessageId, {
            request: { method: 'POST', url: `/api/agents/${agentId}/playground`, headers: { 'Content-Type': 'application/json' }, body: requestBody },
            response: { status: res.status, headers: Object.fromEntries(res.headers.entries()) },
            sseStream: [],
          });
          return next;
        });

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let currentThinking = '';
        let thinkingStartTime = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            rawSseLines.push(line);

            // Parse AI SDK stream format and custom events
            if (line.startsWith('event: ')) {
              const eventType = line.slice(7);
              // Will be paired with next data line
              buffer = eventType + '\n' + buffer;
            } else if (line.startsWith('0:')) {
              // AI SDK text delta format
              const text = JSON.parse(line.slice(2));
              fullText += text;
              setMessages((prev) => {
                const existing = prev.find((m) => m.id === assistantMessageId);
                if (existing) {
                  return prev.map((m) => m.id === assistantMessageId ? { ...m, parts: [{ type: 'text' as const, text: fullText }] } : m);
                }
                return [...prev, { id: assistantMessageId, role: 'assistant' as const, parts: [{ type: 'text' as const, text: fullText }], executionId }];
              });
            } else if (line.startsWith('data: ')) {
              // Custom SSE event
              try {
                const data = JSON.parse(line.slice(6));
                const eventType = data.type ?? 'unknown';
                const relativeMs = Date.now() - requestStartTime;

                const consoleEvent: ConsoleEvent = {
                  id: crypto.randomUUID(),
                  messageId: assistantMessageId,
                  timestamp: Date.now(),
                  relativeMs,
                  severity: eventType === 'error' ? 'error' : 'info',
                  type: eventType,
                  data,
                };
                setConsoleEvents((prev) => [...prev, consoleEvent]);

                if (eventType === 'execution_end') {
                  const usage = data.usage ?? {};
                  const metrics: MessageMetrics = {
                    messageId: assistantMessageId,
                    inputTokens: usage.inputTokens ?? 0,
                    outputTokens: usage.outputTokens ?? 0,
                    thinkingTokens: usage.thinkingTokens ?? 0,
                    totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.thinkingTokens ?? 0),
                    ttftMs: data.ttftMs ?? 0,
                    durationMs: data.durationMs ?? (Date.now() - requestStartTime),
                    model: data.model ?? 'unknown',
                    costEstimate: data.costEstimate ?? calculateCost(data.model ?? '', usage),
                  };
                  setMessageMetrics((prev) => { const next = new Map(prev); next.set(assistantMessageId, metrics); return next; });
                }
              } catch { /* skip */ }
            }
          }
        }

        setRawDataMap((prev) => {
          const next = new Map(prev);
          const existing = next.get(assistantMessageId);
          if (existing) next.set(assistantMessageId, { ...existing, sseStream: rawSseLines });
          return next;
        });

        if (fullText && !messages.find((m) => m.id === assistantMessageId)) {
          setMessages((prev) => {
            if (prev.find((m) => m.id === assistantMessageId)) return prev;
            return [...prev, { id: assistantMessageId, role: 'assistant' as const, parts: [{ type: 'text' as const, text: fullText }], executionId }];
          });
        }
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsGraphLoading(false);
      }
      return;
    }
```

- [ ] **Step 4: Update hook return values**

Add the new state to the return object:

```typescript
  return {
    messages,
    isLoading,
    overrides,
    setOverrides,
    executions,
    refreshExecutions,
    handleSend,
    handleRegenerate,
    setMessages,
    // New console data
    consoleEvents,
    messageMetrics,
    rawDataMap,
    thinkingMap,
    setConsoleEvents,
  };
```

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/hooks/use-playground.ts
git commit -m "feat(playground): capture SSE events and metrics in usePlayground hook"
```

---

## Task 5: Create useConsole Hook

**Files:**
- Create: `apps/web-ui/hooks/use-console.ts`

- [ ] **Step 1: Create the hook**

```typescript
// apps/web-ui/hooks/use-console.ts
'use client';

import { useState, useMemo, useCallback } from 'react';
import type { ConsoleEvent, ConsoleTab, EventSeverity, MessageMetrics, SessionMetrics, RawData } from '@/lib/playground/types';

interface UseConsoleOptions {
  consoleEvents: ConsoleEvent[];
  messageMetrics: Map<string, MessageMetrics>;
  rawDataMap: Map<string, RawData>;
}

export function useConsole({ consoleEvents, messageMetrics, rawDataMap }: UseConsoleOptions) {
  const [activeTab, setActiveTab] = useState<ConsoleTab>('events');
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Set<EventSeverity>>(new Set(['info', 'warn', 'error']));
  const [eventTypeFilter, setEventTypeFilter] = useState<Set<string>>(new Set());
  const [isAutoScrolling, setIsAutoScrolling] = useState(true);

  const filteredEvents = useMemo(() => {
    let events = consoleEvents;

    if (selectedMessageId) {
      events = events.filter((e) => e.messageId === selectedMessageId);
    }

    events = events.filter((e) => severityFilter.has(e.severity));

    if (eventTypeFilter.size > 0) {
      events = events.filter((e) => eventTypeFilter.has(e.type));
    }

    return events;
  }, [consoleEvents, selectedMessageId, severityFilter, eventTypeFilter]);

  const selectedMetrics = useMemo(() => {
    if (!selectedMessageId) return null;
    return messageMetrics.get(selectedMessageId) ?? null;
  }, [selectedMessageId, messageMetrics]);

  const sessionMetrics = useMemo((): SessionMetrics => {
    const allMetrics = Array.from(messageMetrics.values());
    const totalTokens = allMetrics.reduce((sum, m) => sum + m.totalTokens, 0);
    const totalCost = allMetrics.reduce((sum, m) => sum + m.costEstimate.total, 0);
    const messageCount = allMetrics.length;
    const avgTokensPerMessage = messageCount > 0 ? totalTokens / messageCount : 0;
    const avgLatencyMs = messageCount > 0
      ? allMetrics.reduce((sum, m) => sum + m.durationMs, 0) / messageCount
      : 0;

    return {
      totalTokens,
      totalCost,
      messageCount,
      avgTokensPerMessage,
      avgLatencyMs,
      tokensByMessage: allMetrics.map((m) => ({
        messageId: m.messageId,
        input: m.inputTokens,
        output: m.outputTokens,
        thinking: m.thinkingTokens,
      })),
      latencyByMessage: allMetrics.map((m) => ({
        messageId: m.messageId,
        durationMs: m.durationMs,
      })),
    };
  }, [messageMetrics]);

  const selectedRawData = useMemo(() => {
    if (!selectedMessageId) return null;
    return rawDataMap.get(selectedMessageId) ?? null;
  }, [selectedMessageId, rawDataMap]);

  const eventTypes = useMemo(() => {
    const types = new Set<string>();
    consoleEvents.forEach((e) => types.add(e.type));
    return Array.from(types).sort();
  }, [consoleEvents]);

  const selectMessage = useCallback((messageId: string | null) => {
    setSelectedMessageId(messageId);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedMessageId(null);
  }, []);

  return {
    activeTab,
    setActiveTab,
    selectedMessageId,
    selectMessage,
    clearSelection,
    severityFilter,
    setSeverityFilter,
    eventTypeFilter,
    setEventTypeFilter,
    isAutoScrolling,
    setIsAutoScrolling,
    filteredEvents,
    selectedMetrics,
    sessionMetrics,
    selectedRawData,
    eventTypes,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/hooks/use-console.ts
git commit -m "feat(playground): add useConsole hook for console state management"
```

---

## Task 6: ThinkingBlock and MessageMetadataBar Components

**Files:**
- Create: `apps/web-ui/components/agents/playground/thinking-block.tsx`
- Create: `apps/web-ui/components/agents/playground/message-metadata-bar.tsx`

- [ ] **Step 1: Create ThinkingBlock component**

```typescript
// apps/web-ui/components/agents/playground/thinking-block.tsx
'use client';

import { useState } from 'react';
import { ChevronRight, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ThinkingContent } from '@/lib/playground/types';

interface ThinkingBlockProps {
  thinking: ThinkingContent;
}

export function ThinkingBlock({ thinking }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Brain className="h-3 w-3" />
        <span>Thought for {(thinking.durationMs / 1000).toFixed(1)}s</span>
        <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="mt-1.5 rounded-md bg-muted/50 border px-3 py-2 text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-48 overflow-auto">
          {thinking.text}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create MessageMetadataBar component**

```typescript
// apps/web-ui/components/agents/playground/message-metadata-bar.tsx
'use client';

import { Zap, Coins, Cpu } from 'lucide-react';
import type { MessageMetrics } from '@/lib/playground/types';

interface MessageMetadataBarProps {
  metrics: MessageMetrics | undefined;
  isStreaming?: boolean;
  elapsedMs?: number;
}

export function MessageMetadataBar({ metrics, isStreaming, elapsedMs }: MessageMetadataBarProps) {
  if (!metrics && !isStreaming) return null;

  if (isStreaming) {
    return (
      <div className="flex items-center gap-3 mt-1.5 pt-1.5 border-t border-border/50 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          Generating...
        </span>
        {elapsedMs !== undefined && (
          <span className="flex items-center gap-1">
            <Zap className="h-2.5 w-2.5" />
            {(elapsedMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="flex items-center gap-3 mt-1.5 pt-1.5 border-t border-border/50 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1" title="Total latency">
        <Zap className="h-2.5 w-2.5" />
        {metrics.durationMs < 1000
          ? `${metrics.durationMs}ms`
          : `${(metrics.durationMs / 1000).toFixed(1)}s`}
      </span>
      <span className="flex items-center gap-1" title="Total tokens">
        <Coins className="h-2.5 w-2.5" />
        {metrics.totalTokens.toLocaleString()} tokens
      </span>
      <span className="flex items-center gap-1" title="Model">
        <Cpu className="h-2.5 w-2.5" />
        {metrics.model.split('/').pop()?.split(':')[0] ?? metrics.model}
      </span>
      {metrics.costEstimate.total > 0 && (
        <span className="text-[10px]" title="Estimated cost">
          ${metrics.costEstimate.total.toFixed(4)}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/components/agents/playground/thinking-block.tsx apps/web-ui/components/agents/playground/message-metadata-bar.tsx
git commit -m "feat(playground): add ThinkingBlock and MessageMetadataBar components"
```

---

## Task 7: Console Tab Components — Events & Raw

**Files:**
- Create: `apps/web-ui/components/agents/playground/console-events.tsx`
- Create: `apps/web-ui/components/agents/playground/console-raw.tsx`

- [ ] **Step 1: Create ConsoleEvents component**

```typescript
// apps/web-ui/components/agents/playground/console-events.tsx
'use client';

import { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowDown } from 'lucide-react';
import type { ConsoleEvent, EventSeverity } from '@/lib/playground/types';

interface ConsoleEventsProps {
  events: ConsoleEvent[];
  isAutoScrolling: boolean;
  onAutoScrollChange: (value: boolean) => void;
  severityFilter: Set<EventSeverity>;
  onSeverityFilterChange: (filter: Set<EventSeverity>) => void;
  eventTypes: string[];
  eventTypeFilter: Set<string>;
  onEventTypeFilterChange: (filter: Set<string>) => void;
}

const SEVERITY_COLORS: Record<EventSeverity, string> = {
  info: 'text-green-500',
  warn: 'text-yellow-500',
  error: 'text-red-500',
};

function formatRelativeMs(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  return `+${(ms / 1000).toFixed(1)}s`;
}

function getEventDetail(event: ConsoleEvent): string {
  const d = event.data;
  switch (event.type) {
    case 'execution_start':
      return `model: ${d.model}, temp: ${d.temperature}`;
    case 'tool_call':
      return `${d.toolName}(${JSON.stringify(d.args).slice(0, 60)})`;
    case 'tool_result':
      return `${d.toolName} → ${JSON.stringify(d.result).slice(0, 60)}`;
    case 'thinking_end':
      return `${d.tokens} tokens, ${d.durationMs}ms`;
    case 'execution_end':
      return `total: ${((d.durationMs as number) / 1000).toFixed(1)}s, tokens: ${(d.usage as any)?.inputTokens ?? 0}+${(d.usage as any)?.outputTokens ?? 0}`;
    case 'error':
      return String(d.message ?? '');
    case 'text_delta':
      return '';
    default:
      return JSON.stringify(d).slice(0, 80);
  }
}

export function ConsoleEvents({
  events,
  isAutoScrolling,
  onAutoScrollChange,
  severityFilter,
  onSeverityFilterChange,
  eventTypes,
  eventTypeFilter,
  onEventTypeFilterChange,
}: ConsoleEventsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAutoScrolling && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events.length, isAutoScrolling]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (!atBottom && isAutoScrolling) onAutoScrollChange(false);
  };

  // Filter out text_delta noise by default (too many events)
  const displayEvents = events.filter((e) => e.type !== 'text_delta');

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b shrink-0">
        <div className="flex gap-1">
          {(['info', 'warn', 'error'] as EventSeverity[]).map((sev) => (
            <button
              key={sev}
              onClick={() => {
                const next = new Set(severityFilter);
                if (next.has(sev)) next.delete(sev);
                else next.add(sev);
                onSeverityFilterChange(next);
              }}
              className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-mono uppercase transition-opacity',
                SEVERITY_COLORS[sev],
                !severityFilter.has(sev) && 'opacity-30'
              )}
            >
              {sev}
            </button>
          ))}
        </div>
        {eventTypes.length > 0 && (
          <Select
            value={eventTypeFilter.size === 0 ? 'all' : Array.from(eventTypeFilter)[0]}
            onValueChange={(val) => {
              if (val === 'all') onEventTypeFilterChange(new Set());
              else onEventTypeFilterChange(new Set([val]));
            }}
          >
            <SelectTrigger className="h-6 text-[10px] w-[120px]">
              <SelectValue placeholder="All events" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {eventTypes.filter((t) => t !== 'text_delta').map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-auto font-mono text-[11px]" onScroll={handleScroll} ref={scrollRef}>
        {displayEvents.length === 0 && (
          <p className="text-xs text-muted-foreground p-3">Run the agent to see events.</p>
        )}
        <table className="w-full">
          <tbody>
            {displayEvents.map((event) => (
              <tr key={event.id} className="border-b border-border/30 hover:bg-muted/30">
                <td className="px-2 py-1 text-muted-foreground whitespace-nowrap w-[70px]">
                  {formatRelativeMs(event.relativeMs)}
                </td>
                <td className={cn('px-1 py-1 w-[40px]', SEVERITY_COLORS[event.severity])}>
                  {event.severity.toUpperCase()}
                </td>
                <td className="px-2 py-1 whitespace-nowrap font-medium w-[120px]">
                  {event.type}
                </td>
                <td className="px-2 py-1 text-muted-foreground truncate max-w-[200px]">
                  {getEventDetail(event)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div ref={bottomRef} />
      </div>

      {/* Resume auto-scroll */}
      {!isAutoScrolling && (
        <div className="absolute bottom-2 right-2">
          <Button size="icon" variant="secondary" className="h-6 w-6" onClick={() => onAutoScrollChange(true)}>
            <ArrowDown className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create ConsoleRaw component**

```typescript
// apps/web-ui/components/agents/playground/console-raw.tsx
'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Copy, Check, WrapText } from 'lucide-react';
import type { RawData } from '@/lib/playground/types';

interface ConsoleRawProps {
  rawData: RawData | null;
}

type RawSubTab = 'request' | 'response' | 'sse';

export function ConsoleRaw({ rawData }: ConsoleRawProps) {
  const [subTab, setSubTab] = useState<RawSubTab>('request');
  const [wordWrap, setWordWrap] = useState(true);
  const [copied, setCopied] = useState(false);

  if (!rawData) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground">Select a message to view raw data.</p>
      </div>
    );
  }

  const getContent = (): string => {
    switch (subTab) {
      case 'request':
        return JSON.stringify(rawData.request, null, 2);
      case 'response':
        return JSON.stringify(rawData.response, null, 2);
      case 'sse':
        return rawData.sseStream.join('\n');
    }
  };

  const content = getContent();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tabs */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b shrink-0">
        <div className="flex gap-1">
          {([['request', 'Request'], ['response', 'Response'], ['sse', 'SSE Stream']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSubTab(key)}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                subTab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setWordWrap(!wordWrap)} title="Toggle word wrap">
            <WrapText className={cn('h-3 w-3', wordWrap && 'text-primary')} />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleCopy} title="Copy">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <pre className={cn(
          'p-3 text-[11px] font-mono text-foreground',
          wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
        )}>
          {content}
        </pre>
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/components/agents/playground/console-events.tsx apps/web-ui/components/agents/playground/console-raw.tsx
git commit -m "feat(playground): add ConsoleEvents and ConsoleRaw tab components"
```

---

## Task 8: Console Tab Components — Trace & Metrics

**Files:**
- Create: `apps/web-ui/components/agents/playground/console-trace.tsx`
- Create: `apps/web-ui/components/agents/playground/console-metrics.tsx`

- [ ] **Step 1: Create ConsoleTrace component**

```typescript
// apps/web-ui/components/agents/playground/console-trace.tsx
'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronRight, CheckCircle2, XCircle, Clock } from 'lucide-react';
import type { ConsoleEvent } from '@/lib/playground/types';

interface ConsoleTraceProps {
  events: ConsoleEvent[];
}

interface TraceItem {
  id: string;
  type: string;
  name: string;
  status: 'completed' | 'failed' | 'running';
  durationMs?: number;
  input?: unknown;
  output?: unknown;
}

function buildTraceItems(events: ConsoleEvent[]): TraceItem[] {
  const items: TraceItem[] = [];
  const toolCalls = new Map<string, TraceItem>();

  for (const event of events) {
    if (event.type === 'tool_call') {
      const item: TraceItem = {
        id: (event.data.id as string) ?? event.id,
        type: 'tool',
        name: String(event.data.toolName ?? 'unknown'),
        status: 'running',
        input: event.data.args,
      };
      toolCalls.set(item.id, item);
      items.push(item);
    } else if (event.type === 'tool_result') {
      const id = (event.data.id as string) ?? '';
      const existing = toolCalls.get(id);
      if (existing) {
        existing.status = 'completed';
        existing.durationMs = event.data.durationMs as number;
        existing.output = event.data.result;
      } else {
        items.push({
          id: event.id,
          type: 'tool',
          name: String(event.data.toolName ?? 'unknown'),
          status: 'completed',
          durationMs: event.data.durationMs as number,
          output: event.data.result,
        });
      }
    } else if (event.type === 'execution_start') {
      items.unshift({
        id: event.id,
        type: 'execution',
        name: `Execution (${event.data.model})`,
        status: 'running',
      });
    } else if (event.type === 'execution_end') {
      const execItem = items.find((i) => i.type === 'execution');
      if (execItem) {
        execItem.status = event.data.error ? 'failed' : 'completed';
        execItem.durationMs = event.data.durationMs as number;
      }
    } else if (event.type === 'error') {
      items.push({
        id: event.id,
        type: 'error',
        name: String(event.data.message ?? 'Error'),
        status: 'failed',
      });
    }
  }

  return items;
}

function TraceItemRow({ item }: { item: TraceItem }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = item.input || item.output;

  const StatusIcon = item.status === 'completed'
    ? CheckCircle2
    : item.status === 'failed'
      ? XCircle
      : Clock;

  const statusColor = item.status === 'completed'
    ? 'text-green-500'
    : item.status === 'failed'
      ? 'text-red-500'
      : 'text-yellow-500';

  return (
    <div className="border-b border-border/30">
      <button
        onClick={() => hasDetail && setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors',
          !hasDetail && 'cursor-default'
        )}
      >
        {hasDetail && (
          <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', expanded && 'rotate-90')} />
        )}
        {!hasDetail && <div className="w-3" />}
        <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', statusColor)} />
        <span className="text-[11px] font-medium truncate">{item.name}</span>
        <Badge variant="outline" className="text-[9px] ml-auto shrink-0">{item.type}</Badge>
        {item.durationMs !== undefined && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {item.durationMs < 1000 ? `${item.durationMs}ms` : `${(item.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-6 pb-2 space-y-1">
          {item.input && (
            <div>
              <span className="text-[9px] uppercase text-muted-foreground font-semibold">Input</span>
              <pre className="text-[10px] bg-muted rounded p-2 mt-0.5 overflow-auto max-h-24">
                {JSON.stringify(item.input, null, 2)}
              </pre>
            </div>
          )}
          {item.output && (
            <div>
              <span className="text-[9px] uppercase text-muted-foreground font-semibold">Output</span>
              <pre className="text-[10px] bg-muted rounded p-2 mt-0.5 overflow-auto max-h-24">
                {JSON.stringify(item.output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ConsoleTrace({ events }: ConsoleTraceProps) {
  const traceItems = buildTraceItems(events);

  if (traceItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground">Run the agent to see execution trace.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="divide-y-0">
        {traceItems.map((item) => (
          <TraceItemRow key={item.id} item={item} />
        ))}
      </div>
    </ScrollArea>
  );
}
```

- [ ] **Step 2: Create ConsoleMetrics component**

```typescript
// apps/web-ui/components/agents/playground/console-metrics.tsx
'use client';

import { cn } from '@/lib/utils';
import { Zap, Coins, Clock, Hash, TrendingUp, Cpu } from 'lucide-react';
import type { MessageMetrics, SessionMetrics } from '@/lib/playground/types';

interface ConsoleMetricsProps {
  selectedMetrics: MessageMetrics | null;
  sessionMetrics: SessionMetrics;
}

function MetricRow({ icon: Icon, label, value, subValue }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  subValue?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 px-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <div className="text-right">
        <span className="text-[11px] font-medium">{value}</span>
        {subValue && <span className="text-[10px] text-muted-foreground ml-1">({subValue})</span>}
      </div>
    </div>
  );
}

function TokenBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="px-3 py-1">
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value.toLocaleString()}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

function PerMessageView({ metrics }: { metrics: MessageMetrics }) {
  const maxTokens = Math.max(metrics.inputTokens, metrics.outputTokens, metrics.thinkingTokens, 1);

  return (
    <div className="space-y-1">
      <div className="px-3 pt-2 pb-1">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">Per-Message Metrics</span>
      </div>

      <div className="space-y-0.5">
        <TokenBar label="Input tokens" value={metrics.inputTokens} max={maxTokens} color="bg-blue-500" />
        <TokenBar label="Output tokens" value={metrics.outputTokens} max={maxTokens} color="bg-green-500" />
        {metrics.thinkingTokens > 0 && (
          <TokenBar label="Thinking tokens" value={metrics.thinkingTokens} max={maxTokens} color="bg-purple-500" />
        )}
      </div>

      <div className="border-t mt-2 pt-1">
        <MetricRow icon={Hash} label="Total tokens" value={metrics.totalTokens.toLocaleString()} />
        <MetricRow icon={Zap} label="Time to first token" value={`${metrics.ttftMs}ms`} />
        <MetricRow icon={Clock} label="Total generation" value={metrics.durationMs < 1000 ? `${metrics.durationMs}ms` : `${(metrics.durationMs / 1000).toFixed(1)}s`} />
        <MetricRow icon={Cpu} label="Model" value={metrics.model.split('/').pop()?.split(':')[0] ?? metrics.model} />
        <MetricRow icon={Coins} label="Cost estimate" value={`$${metrics.costEstimate.total.toFixed(4)}`} subValue={`in: $${metrics.costEstimate.input.toFixed(4)} / out: $${metrics.costEstimate.output.toFixed(4)}`} />
      </div>
    </div>
  );
}

function PerSessionView({ metrics }: { metrics: SessionMetrics }) {
  if (metrics.messageCount === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground">Run the agent to see metrics.</p>
      </div>
    );
  }

  const maxLatency = Math.max(...metrics.latencyByMessage.map((m) => m.durationMs), 1);

  return (
    <div className="space-y-1">
      <div className="px-3 pt-2 pb-1">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">Session Metrics</span>
      </div>

      <MetricRow icon={Hash} label="Total tokens" value={metrics.totalTokens.toLocaleString()} />
      <MetricRow icon={Coins} label="Total cost" value={`$${metrics.totalCost.toFixed(4)}`} />
      <MetricRow icon={TrendingUp} label="Messages" value={String(metrics.messageCount)} />
      <MetricRow icon={Hash} label="Avg tokens/msg" value={Math.round(metrics.avgTokensPerMessage).toLocaleString()} />
      <MetricRow icon={Clock} label="Avg latency" value={metrics.avgLatencyMs < 1000 ? `${Math.round(metrics.avgLatencyMs)}ms` : `${(metrics.avgLatencyMs / 1000).toFixed(1)}s`} />

      {/* Latency sparkline */}
      {metrics.latencyByMessage.length > 1 && (
        <div className="px-3 pt-2">
          <span className="text-[10px] text-muted-foreground">Latency trend</span>
          <div className="flex items-end gap-0.5 h-8 mt-1">
            {metrics.latencyByMessage.map((m, i) => (
              <div
                key={m.messageId}
                className="flex-1 bg-primary/60 rounded-t-sm min-w-[3px]"
                style={{ height: `${(m.durationMs / maxLatency) * 100}%` }}
                title={`${(m.durationMs / 1000).toFixed(1)}s`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ConsoleMetrics({ selectedMetrics, sessionMetrics }: ConsoleMetricsProps) {
  if (selectedMetrics) {
    return <PerMessageView metrics={selectedMetrics} />;
  }
  return <PerSessionView metrics={sessionMetrics} />;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/components/agents/playground/console-trace.tsx apps/web-ui/components/agents/playground/console-metrics.tsx
git commit -m "feat(playground): add ConsoleTrace and ConsoleMetrics tab components"
```

---

## Task 9: PlaygroundConsole Container Component

**Files:**
- Create: `apps/web-ui/components/agents/playground/console.tsx`

- [ ] **Step 1: Create the console container with tab navigation**

```typescript
// apps/web-ui/components/agents/playground/console.tsx
'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Terminal, FileCode, GitBranch, BarChart3, X } from 'lucide-react';
import { ConsoleEvents } from './console-events';
import { ConsoleRaw } from './console-raw';
import { ConsoleTrace } from './console-trace';
import { ConsoleMetrics } from './console-metrics';
import type { ConsoleTab, ConsoleEvent, EventSeverity, MessageMetrics, SessionMetrics, RawData } from '@/lib/playground/types';

interface PlaygroundConsoleProps {
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
  events: ConsoleEvent[];
  isAutoScrolling: boolean;
  onAutoScrollChange: (value: boolean) => void;
  severityFilter: Set<EventSeverity>;
  onSeverityFilterChange: (filter: Set<EventSeverity>) => void;
  eventTypes: string[];
  eventTypeFilter: Set<string>;
  onEventTypeFilterChange: (filter: Set<string>) => void;
  rawData: RawData | null;
  selectedMetrics: MessageMetrics | null;
  sessionMetrics: SessionMetrics;
  selectedMessageId: string | null;
  onClearSelection: () => void;
}

const TABS: { id: ConsoleTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'events', label: 'Events', icon: Terminal },
  { id: 'raw', label: 'Raw', icon: FileCode },
  { id: 'trace', label: 'Trace', icon: GitBranch },
  { id: 'metrics', label: 'Metrics', icon: BarChart3 },
];

export function PlaygroundConsole({
  activeTab,
  onTabChange,
  events,
  isAutoScrolling,
  onAutoScrollChange,
  severityFilter,
  onSeverityFilterChange,
  eventTypes,
  eventTypeFilter,
  onEventTypeFilterChange,
  rawData,
  selectedMetrics,
  sessionMetrics,
  selectedMessageId,
  onClearSelection,
}: PlaygroundConsoleProps) {
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Tab bar */}
      <div className="flex items-center border-b px-2 py-1 shrink-0">
        <div className="flex gap-0.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                activeTab === id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
        {selectedMessageId && (
          <div className="ml-auto flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">Filtered to message</span>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClearSelection}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'events' && (
          <ConsoleEvents
            events={events}
            isAutoScrolling={isAutoScrolling}
            onAutoScrollChange={onAutoScrollChange}
            severityFilter={severityFilter}
            onSeverityFilterChange={onSeverityFilterChange}
            eventTypes={eventTypes}
            eventTypeFilter={eventTypeFilter}
            onEventTypeFilterChange={onEventTypeFilterChange}
          />
        )}
        {activeTab === 'raw' && <ConsoleRaw rawData={rawData} />}
        {activeTab === 'trace' && <ConsoleTrace events={events} />}
        {activeTab === 'metrics' && (
          <ConsoleMetrics selectedMetrics={selectedMetrics} sessionMetrics={sessionMetrics} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web-ui/components/agents/playground/console.tsx
git commit -m "feat(playground): add PlaygroundConsole container component"
```

---

## Task 10: Update ChatMessages with Selection & Metadata

**Files:**
- Modify: `apps/web-ui/components/chat/chat-messages.tsx`
- Modify: `apps/web-ui/components/chat/chat-bubble.tsx`

- [ ] **Step 1: Extend ChatMessages to support message selection and metadata**

Replace the entire `apps/web-ui/components/chat/chat-messages.tsx` file:

```typescript
// apps/web-ui/components/chat/chat-messages.tsx
'use client';

import type { UIMessage } from '@ai-sdk/react';
import { ChatBubble } from './chat-bubble';
import { useChatScroll } from '@/lib/hooks/use-chat-scroll';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { MessageSquare, Sparkles } from 'lucide-react';
import { MessageMetadataBar } from '@/components/agents/playground/message-metadata-bar';
import { ThinkingBlock } from '@/components/agents/playground/thinking-block';
import { cn } from '@/lib/utils';
import type { MessageMetrics, ThinkingContent } from '@/lib/playground/types';

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

interface ChatMessagesProps {
  messages: UIMessage[];
  isLoading?: boolean;
  onRegenerate?: () => void;
  selectedMessageId?: string | null;
  onSelectMessage?: (messageId: string | null) => void;
  messageMetrics?: Map<string, MessageMetrics>;
  thinkingMap?: Map<string, ThinkingContent>;
  showMetadata?: boolean;
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold tracking-tight">How can I help you today?</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Ask me anything — I can help with coding, writing, analysis, brainstorming, and more.
          </p>
        </div>
        <div className="grid gap-2 pt-2">
          {[
            'Explain a complex topic simply',
            'Help me debug this code',
            'Write a professional email',
            'Brainstorm creative ideas',
          ].map((suggestion) => (
            <div
              key={suggestion}
              className="cursor-pointer rounded-lg border bg-card/50 px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {suggestion}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3 px-4 py-5 md:px-6">
      <div className="flex shrink-0 flex-col items-center pt-0.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <MessageSquare className="h-4 w-4 text-primary" />
        </div>
      </div>
      <div className="flex items-center">
        <div className="flex items-center gap-2 rounded-2xl border bg-card/60 px-4 py-3">
          <Spinner />
        </div>
      </div>
    </div>
  );
}

export function ChatMessages({
  messages,
  isLoading,
  onRegenerate,
  selectedMessageId,
  onSelectMessage,
  messageMetrics,
  thinkingMap,
  showMetadata = false,
}: ChatMessagesProps) {
  const scrollRef = useChatScroll(messages);

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-hidden">
        <EmptyState />
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1" ref={scrollRef}>
      <div className="flex flex-col pb-2">
        {messages.map((message) => {
          const isSelected = selectedMessageId === message.id;
          const metrics = messageMetrics?.get(message.id);
          const thinking = thinkingMap?.get(message.id);
          const isAssistant = message.role === 'assistant';

          return (
            <div
              key={message.id}
              className={cn(
                'transition-colors',
                isAssistant && onSelectMessage && 'cursor-pointer',
                isSelected && 'border-l-2 border-l-primary bg-primary/5'
              )}
              onClick={() => {
                if (isAssistant && onSelectMessage) {
                  onSelectMessage(isSelected ? null : message.id);
                }
              }}
            >
              {isAssistant && thinking && <ThinkingBlock thinking={thinking} />}
              <ChatBubble
                role={message.role as 'user' | 'assistant'}
                content={getMessageText(message)}
                onRegenerate={isAssistant ? onRegenerate : undefined}
              />
              {showMetadata && isAssistant && (
                <div className="px-4 md:px-6 -mt-3 ml-11">
                  <MessageMetadataBar
                    metrics={metrics}
                    isStreaming={isLoading && message.id === messages[messages.length - 1]?.id}
                  />
                </div>
              )}
            </div>
          );
        })}
        {isLoading && messages[messages.length - 1]?.role === 'user' && <TypingIndicator />}
      </div>
    </ScrollArea>
  );
}
```

- [ ] **Step 2: Add sanitization to ChatBubble**

In `apps/web-ui/components/chat/chat-bubble.tsx`, add the import at the top:

```typescript
import { sanitizeMarkdown } from '@/lib/playground/sanitize';
```

Change line 172 from `{content}` to `{sanitizeMarkdown(content)}` inside the ReactMarkdown component.

- [ ] **Step 3: Verify the component compiles**

Run: `bunx tsc --noEmit --project apps/web-ui/tsconfig.json 2>&1 | head -30`
Expected: No errors related to the modified files.

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui/components/chat/chat-messages.tsx apps/web-ui/components/chat/chat-bubble.tsx
git commit -m "feat(playground): add message selection, metadata bar, and thinking block to chat"
```

---

## Task 11: Wire Up Playground Page with Resizable Split Panel

**Files:**
- Modify: `apps/web-ui/app/(dashboard)/agents/[id]/playground/page.tsx`

- [ ] **Step 1: Replace the right sidebar with resizable split panel**

Replace the entire playground page. Key changes:
1. Import `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` from `@/components/ui/resizable`
2. Import `PlaygroundConsole` and `useConsole`
3. Replace the right `<div className="w-80 border-l ...">` with a resizable panel group
4. Pass console data from `usePlayground` to `useConsole` to `PlaygroundConsole`
5. Pass selection/metrics props to `ChatMessages`

Replace the imports section (lines 1-50) with:

```typescript
'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAgent } from '@/hooks/use-agents';
import { useAgentVersions } from '@/hooks/use-agent-versions';
import { usePlayground } from '@/hooks/use-playground';
import { useConsole } from '@/hooks/use-console';
import {
  usePlaygroundSessions,
  useCreatePlaygroundSession,
  useUpdatePlaygroundSession,
  useDeletePlaygroundSession,
} from '@/hooks/use-playground-sessions';
import { ChatMessages } from '@/components/chat/chat-messages';
import { ChatInput } from '@/components/chat/chat-input';
import { PlaygroundConsole } from '@/components/agents/playground/console';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Play,
  Save,
  Trash2,
  Loader2,
  Bot,
  Plus,
  Settings,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
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
import { PlaygroundVersionSelector } from '@/components/agents/playground/version-selector';
```

- [ ] **Step 2: Add useConsole hook and panel collapse state**

Inside the component, after the `usePlayground` call, add:

```typescript
  const {
    activeTab,
    setActiveTab,
    selectedMessageId,
    selectMessage,
    clearSelection,
    severityFilter,
    setSeverityFilter,
    eventTypeFilter,
    setEventTypeFilter,
    isAutoScrolling,
    setIsAutoScrolling,
    filteredEvents,
    selectedMetrics,
    sessionMetrics,
    selectedRawData,
    eventTypes,
  } = useConsole({
    consoleEvents,
    messageMetrics,
    rawDataMap,
  });

  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
```

And destructure the new values from `usePlayground`:

```typescript
  const {
    messages,
    isLoading,
    overrides,
    setOverrides,
    executions,
    refreshExecutions,
    handleSend,
    handleRegenerate,
    setMessages,
    consoleEvents,
    messageMetrics,
    rawDataMap,
    thinkingMap,
  } = usePlayground({
    agentId,
    agentType: agent?.type ?? 'simple',
    versionId: selectedVersionId,
    alias: selectedAlias,
    onError: (err) => toast.error(err.message),
  });
```

- [ ] **Step 3: Replace the Main Content section (lines 293-491)**

Replace the `{/* Main Content */}` div with:

```typescript
      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sessions Sidebar */}
        <div className="w-64 border-r bg-muted/30 flex flex-col shrink-0">
          <div className="px-3 py-2 border-b">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Sessions</h3>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {sessionsLoading && (
                <div className="text-xs text-muted-foreground px-2 py-4 text-center">Loading...</div>
              )}
              {sessions?.length === 0 && !sessionsLoading && (
                <div className="text-xs text-muted-foreground px-2 py-4 text-center">No saved sessions</div>
              )}
              {sessions?.map((session) => (
                <button
                  key={session.id}
                  onClick={() => handleLoadSession(session)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-md text-xs transition-colors group flex items-center justify-between',
                    activeSessionId === session.id
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-accent text-muted-foreground'
                  )}
                >
                  <div className="flex flex-col truncate">
                    <span className="font-medium truncate">{session.name}</span>
                    <span className="text-[10px] opacity-70">
                      {new Date(session.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteSessionTarget(session.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Chat + Right Panel */}
        <ResizablePanelGroup direction="horizontal" className="flex-1" autoSaveId="playground-horizontal">
          {/* Chat Area */}
          <ResizablePanel defaultSize={rightPanelCollapsed ? 100 : 55} minSize={35}>
            <div className="flex flex-col h-full min-w-0">
              <div className="px-4 py-2 border-b bg-background shrink-0 flex items-center gap-2">
                <Input
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  className="h-7 text-sm font-medium border-0 bg-transparent focus-visible:ring-0 px-0 w-auto min-w-[200px]"
                  placeholder="Session name..."
                />
                {activeSessionId && (
                  <Badge variant="outline" className="text-[10px]">Saved</Badge>
                )}
                <div className="ml-auto">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
                    title={rightPanelCollapsed ? 'Show console' : 'Hide console'}
                  >
                    {rightPanelCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <ChatMessages
                messages={messages}
                isLoading={isLoading}
                onRegenerate={handleRegenerate}
                selectedMessageId={selectedMessageId}
                onSelectMessage={selectMessage}
                messageMetrics={messageMetrics}
                thinkingMap={thinkingMap}
                showMetadata
              />
              <ChatInput onSend={handleSend} isLoading={isLoading} />
            </div>
          </ResizablePanel>

          {/* Resizable Handle */}
          {!rightPanelCollapsed && <ResizableHandle withHandle />}

          {/* Right Panel: Console + Config */}
          {!rightPanelCollapsed && (
            <ResizablePanel defaultSize={45} minSize={25} maxSize={60}>
              <ResizablePanelGroup direction="vertical" autoSaveId="playground-vertical">
                {/* Console (top) */}
                <ResizablePanel defaultSize={65} minSize={30}>
                  <PlaygroundConsole
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                    events={filteredEvents}
                    isAutoScrolling={isAutoScrolling}
                    onAutoScrollChange={setIsAutoScrolling}
                    severityFilter={severityFilter}
                    onSeverityFilterChange={setSeverityFilter}
                    eventTypes={eventTypes}
                    eventTypeFilter={eventTypeFilter}
                    onEventTypeFilterChange={setEventTypeFilter}
                    rawData={selectedRawData}
                    selectedMetrics={selectedMetrics}
                    sessionMetrics={sessionMetrics}
                    selectedMessageId={selectedMessageId}
                    onClearSelection={clearSelection}
                  />
                </ResizablePanel>

                {/* Drag handle */}
                <ResizableHandle withHandle />

                {/* Config (bottom) */}
                <ResizablePanel defaultSize={35} minSize={15} collapsible>
                  <ScrollArea className="h-full">
                    <div className="p-4 space-y-4">
                      {/* Version Selector */}
                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Version</label>
                        <PlaygroundVersionSelector
                          agentId={agentId}
                          value={versionValue}
                          onChange={handleVersionChange}
                        />
                      </div>

                      <Separator />

                      {/* Overrides */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                          <label className="text-xs font-semibold uppercase text-muted-foreground">Overrides</label>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-muted-foreground">Model</label>
                          <Input
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            placeholder="Override model..."
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-muted-foreground">System Prompt</label>
                          <Textarea
                            value={systemPrompt}
                            onChange={(e) => setSystemPrompt(e.target.value)}
                            placeholder="Override system prompt..."
                            rows={3}
                            className="text-xs resize-none"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-muted-foreground">Temperature: {temperature}</label>
                          <input
                            type="range"
                            min={0}
                            max={2}
                            step={0.1}
                            value={temperature}
                            onChange={(e) => setTemperature(parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-muted-foreground">Max Tokens: {maxTokens ?? 'default'}</label>
                          <Input
                            type="number"
                            value={maxTokens ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setMaxTokens(val ? parseInt(val, 10) : undefined);
                            }}
                            placeholder="Leave blank for default"
                            className="h-8 text-xs"
                          />
                        </div>
                        <Button size="sm" className="w-full" onClick={handleApplyOverrides}>
                          <Play className="h-3.5 w-3.5 mr-1" />
                          Apply Overrides
                        </Button>
                      </div>
                    </div>
                  </ScrollArea>
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      </div>
```

- [ ] **Step 4: Verify the page compiles and renders**

Run: `bun run dev`
Navigate to `/agents/<id>/playground`. Verify:
- Three-column layout renders
- Right panel has Console (tabbed) on top, Config on bottom
- Drag handles work for resizing
- Panel collapse button works

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/app/\(dashboard\)/agents/\[id\]/playground/page.tsx
git commit -m "feat(playground): wire up resizable split panel with console and config"
```

---

## Task 12: Integration Testing & Polish

**Files:**
- All previously created/modified files

- [ ] **Step 1: End-to-end manual test**

Run: `bun run dev`

Test the following scenarios:
1. Send a message → verify markdown renders (tables, code blocks, lists)
2. Check Console Events tab shows `execution_start`, `execution_end` events
3. Check Metrics tab shows token counts and latency after response completes
4. Click an assistant message → verify console filters to that message
5. Click "Show All" (X button) → verify console shows all events
6. Check Raw tab shows request/response JSON when a message is selected
7. Resize panels via drag handles → verify they persist on page refresh (localStorage)
8. Collapse right panel → verify chat takes full width
9. For graph agents: verify Trace tab shows node execution path

- [ ] **Step 2: Fix any TypeScript errors**

Run: `bunx tsc --noEmit --project apps/web-ui/tsconfig.json 2>&1 | head -50`
Fix any type errors found.

- [ ] **Step 3: Run existing tests to ensure no regressions**

Run: `bun run test`
Expected: All existing tests pass.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(playground): address type errors and polish console integration"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Shared types, cost utility, sanitizer | 3 new |
| 2 | Fix markdown rendering | 1 modified |
| 3 | Enhanced SSE protocol | 1 modified |
| 4 | Extend usePlayground hook | 1 modified |
| 5 | Create useConsole hook | 1 new |
| 6 | ThinkingBlock + MetadataBar | 2 new |
| 7 | ConsoleEvents + ConsoleRaw | 2 new |
| 8 | ConsoleTrace + ConsoleMetrics | 2 new |
| 9 | PlaygroundConsole container | 1 new |
| 10 | Update ChatMessages with selection | 2 modified |
| 11 | Wire up playground page | 1 modified |
| 12 | Integration testing & polish | all |

**Total: 11 new files, 5 modified files, 12 tasks**

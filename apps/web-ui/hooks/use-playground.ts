'use client';

import { useState, useCallback, useEffect } from 'react';
import type { UIMessage } from '@ai-sdk/react';
import type { ConsoleEvent, MessageMetrics, RawData, ThinkingContent } from '@/lib/playground/types';
import { calculateCost } from '@/lib/playground/cost';

export interface PlaygroundOverrides {
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface PlaygroundMessage extends UIMessage {
  executionId?: string;
  trace?: Record<string, unknown>;
}

interface UsePlaygroundOptions {
  agentId: string;
  agentType: 'simple' | 'graph';
  versionId?: string;
  alias?: string;
  initialMessages?: PlaygroundMessage[];
  onError?: (error: Error) => void;
}

export function usePlayground({
  agentId,
  agentType,
  versionId,
  alias,
  initialMessages = [],
  onError,
}: UsePlaygroundOptions) {
  const [overrides, setOverrides] = useState<PlaygroundOverrides>({});
  const [executions, setExecutions] = useState<
    Array<{
      id: string;
      status: string;
      createdAt: string;
      output?: Record<string, unknown>;
      trace?: Record<string, unknown>;
    }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<PlaygroundMessage[]>(initialMessages);

  // Console state
  const [consoleEvents, setConsoleEvents] = useState<ConsoleEvent[]>([]);
  const [messageMetrics, setMessageMetrics] = useState<Map<string, MessageMetrics>>(new Map());
  const [rawDataMap, setRawDataMap] = useState<Map<string, RawData>>(new Map());
  const [thinkingMap, setThinkingMap] = useState<Map<string, ThinkingContent>>(new Map());

  // Load initial messages when provided
  useEffect(() => {
    if (initialMessages.length > 0) {
      setMessages(initialMessages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = useCallback(
    async (content: string) => {
      if (!agentId) return;

      setIsLoading(true);
      const assistantMessageId = crypto.randomUUID();
      const requestStartTime = Date.now();
      let fullText = '';
      const rawSseLines: string[] = [];
      let currentThinking = '';
      let thinkingStartTime = 0;

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

      try {
        const res = await fetch(`/api/agents/${agentId}/playground`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
          throw new Error('Failed to run agent');
        }

        const executionId = res.headers.get('x-execution-id') ?? undefined;

        // Record raw request/response metadata
        setRawDataMap((prev) => {
          const next = new Map(prev);
          next.set(assistantMessageId, {
            request: {
              method: 'POST',
              url: `/api/agents/${agentId}/playground`,
              headers: { 'Content-Type': 'application/json' },
              body: requestBody,
            },
            response: {
              status: res.status,
              headers: Object.fromEntries(res.headers.entries()),
            },
            sseStream: [],
          });
          return next;
        });

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        // Unified SSE parsing for both simple and graph agents.
        // Simple agents: AI SDK UI message stream lines (0:, 2:, e:, d:) interleaved
        //   with custom event: / data: pairs for execution_start / execution_end.
        // Graph agents: pure custom event: / data: pairs.
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let pendingEventType = '';
          for (const line of lines) {
            rawSseLines.push(line);

            if (line.startsWith('event: ')) {
              pendingEventType = line.slice(7).trim();
            } else if (line.startsWith('data: ') && pendingEventType) {
              // Named SSE event (custom protocol)
              const rawData = line.slice(6);
              try {
                const data = JSON.parse(rawData) as Record<string, unknown>;
                const relativeMs = Date.now() - requestStartTime;

                const consoleEvent: ConsoleEvent = {
                  id: crypto.randomUUID(),
                  messageId: assistantMessageId,
                  timestamp: Date.now(),
                  relativeMs,
                  severity: pendingEventType === 'error' ? 'error' : 'info',
                  type: pendingEventType,
                  data,
                };
                setConsoleEvents((prev) => [...prev, consoleEvent]);

                if (pendingEventType === 'text_delta' && typeof data.delta === 'string') {
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
                } else if (pendingEventType === 'thinking_start') {
                  thinkingStartTime = Date.now();
                  currentThinking = '';
                } else if (pendingEventType === 'thinking_delta' && typeof data.delta === 'string') {
                  currentThinking += data.delta;
                } else if (pendingEventType === 'thinking_end') {
                  setThinkingMap((prev) => {
                    const next = new Map(prev);
                    next.set(assistantMessageId, {
                      text: currentThinking,
                      tokens: (data.tokens as number) ?? 0,
                      durationMs: (data.durationMs as number) ?? Date.now() - thinkingStartTime,
                    });
                    return next;
                  });
                } else if (pendingEventType === 'execution_end') {
                  const usage = (data.usage as { inputTokens?: number; outputTokens?: number; thinkingTokens?: number }) ?? {};
                  const model = (data.model as string) ?? 'unknown';
                  const metrics: MessageMetrics = {
                    messageId: assistantMessageId,
                    inputTokens: usage.inputTokens ?? 0,
                    outputTokens: usage.outputTokens ?? 0,
                    thinkingTokens: usage.thinkingTokens ?? 0,
                    totalTokens:
                      (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.thinkingTokens ?? 0),
                    ttftMs: (data.ttftMs as number) ?? 0,
                    durationMs: (data.durationMs as number) ?? Date.now() - requestStartTime,
                    model,
                    costEstimate: calculateCost(model, {
                      inputTokens: usage.inputTokens ?? 0,
                      outputTokens: usage.outputTokens ?? 0,
                      thinkingTokens: usage.thinkingTokens,
                    }),
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
              pendingEventType = '';
            } else if (line.startsWith('0:') && agentType === 'simple') {
              // AI SDK text delta format: 0:"chunk"
              try {
                const chunk = JSON.parse(line.slice(2)) as string;
                fullText += chunk;
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
              } catch {
                // skip
              }
              pendingEventType = '';
            } else {
              // Non-data line resets pending event type
              if (line === '') pendingEventType = '';
            }
          }
        }

        // Persist raw SSE lines
        setRawDataMap((prev) => {
          const next = new Map(prev);
          const existing = next.get(assistantMessageId);
          if (existing) {
            next.set(assistantMessageId, { ...existing, sseStream: rawSseLines });
          }
          return next;
        });

        // Ensure assistant message exists even if stream produced no text_delta events
        if (fullText) {
          setMessages((prev) => {
            if (prev.find((m) => m.id === assistantMessageId)) return prev;
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
        }
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsLoading(false);
      }
    },
    [agentId, agentType, versionId, alias, overrides, messages, onError]
  );

  const handleRegenerate = useCallback(() => {
    if (!agentId) return;
    const lastUserMessage = messages.filter((m) => m.role === 'user').pop();
    if (lastUserMessage) {
      const text = lastUserMessage.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('');
      handleSend(text);
    }
  }, [agentId, messages, handleSend]);

  const refreshExecutions = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/playground/executions`);
      if (res.ok) {
        const data = await res.json();
        setExecutions(data);
      }
    } catch {
      // ignore
    }
  }, [agentId]);

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
    // Console data
    consoleEvents,
    messageMetrics,
    rawDataMap,
    thinkingMap,
    setConsoleEvents,
  };
}

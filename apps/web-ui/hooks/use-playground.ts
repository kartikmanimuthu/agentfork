'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useChat, type UIMessage } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
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
  const [isGraphLoading, setIsGraphLoading] = useState(false);

  // Console state
  const [consoleEvents, setConsoleEvents] = useState<ConsoleEvent[]>([]);
  const [messageMetrics, setMessageMetrics] = useState<Map<string, MessageMetrics>>(new Map());
  const [rawDataMap, setRawDataMap] = useState<Map<string, RawData>>(new Map());
  const [thinkingMap, setThinkingMap] = useState<Map<string, ThinkingContent>>(new Map());

  // For simple agents, use AI SDK streaming
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/agents/${agentId}/playground`,
        body: {
          agentVersionId: versionId,
          alias,
          systemPrompt: overrides.systemPrompt,
          model: overrides.model,
          temperature: overrides.temperature,
          maxTokens: overrides.maxTokens,
        },
      }),
    [agentId, versionId, alias, overrides]
  );

  const {
    messages: aiMessages,
    status,
    sendMessage,
    setMessages: setAiMessages,
  } = useChat({
    transport,
    onError: (err) => {
      onError?.(err);
    },
    onFinish: async ({ message }) => {
      // After AI SDK stream completes, fetch execution metrics
      try {
        const res = await fetch(`/api/agents/${agentId}/playground/executions`);
        if (res.ok) {
          const data = await res.json();
          if (data.length > 0) {
            const latestExec = data[0];
            const output = latestExec.output as { usage?: { inputTokens?: number; outputTokens?: number }; durationMs?: number; model?: string } | null;

            // Populate raw data for the Raw tab
            setRawDataMap((prev) => {
              const next = new Map(prev);
              next.set(message.id, {
                request: {
                  method: 'POST',
                  url: `/api/agents/${agentId}/playground`,
                  headers: { 'Content-Type': 'application/json' },
                  body: {
                    agentVersionId: versionId,
                    alias,
                    systemPrompt: overrides.systemPrompt,
                    model: overrides.model,
                    temperature: overrides.temperature,
                    maxTokens: overrides.maxTokens,
                  },
                },
                response: {
                  status: 200,
                  headers: { 'x-execution-id': latestExec.id },
                },
                sseStream: output
                  ? [
                      `event: execution_start`,
                      `data: ${JSON.stringify({ model: output.model, executionId: latestExec.id })}`,
                      `event: execution_end`,
                      `data: ${JSON.stringify({ usage: output.usage, durationMs: output.durationMs, model: output.model })}`,
                    ]
                  : [],
              });
              return next;
            });

            if (output?.usage) {
              const model = output.model ?? 'unknown';
              const metrics: MessageMetrics = {
                messageId: message.id,
                inputTokens: output.usage.inputTokens ?? 0,
                outputTokens: output.usage.outputTokens ?? 0,
                thinkingTokens: 0,
                totalTokens: (output.usage.inputTokens ?? 0) + (output.usage.outputTokens ?? 0),
                ttftMs: 0,
                durationMs: output.durationMs ?? 0,
                model,
                costEstimate: calculateCost(model, {
                  inputTokens: output.usage.inputTokens ?? 0,
                  outputTokens: output.usage.outputTokens ?? 0,
                }),
              };
              setMessageMetrics((prev) => {
                const next = new Map(prev);
                next.set(message.id, metrics);
                return next;
              });

              // Add console events for the execution
              const now = Date.now();
              setConsoleEvents((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  messageId: message.id,
                  timestamp: now,
                  relativeMs: 0,
                  severity: 'info',
                  type: 'execution_start',
                  data: { model, executionId: latestExec.id },
                },
                {
                  id: crypto.randomUUID(),
                  messageId: message.id,
                  timestamp: now,
                  relativeMs: output.durationMs ?? 0,
                  severity: 'info',
                  type: 'execution_end',
                  data: {
                    usage: output.usage,
                    durationMs: output.durationMs,
                    model,
                  },
                },
              ]);
            }
          }
        }
      } catch {
        // Non-critical — metrics just won't show
      }
    },
  });

  // Load initial messages when provided
  useEffect(() => {
    if (initialMessages.length > 0) {
      setAiMessages(initialMessages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLoading = status === 'streaming' || status === 'submitted' || isGraphLoading;

  // Use AI SDK messages for simple agents, local state for graph agents
  const [graphMessages, setGraphMessages] = useState<PlaygroundMessage[]>([]);
  const messages = agentType === 'simple' ? aiMessages : graphMessages;
  const setMessages = agentType === 'simple' ? setAiMessages : setGraphMessages;

  const handleSend = useCallback(
    async (content: string, attachments?: Array<{ fileId: string; s3Key: string; mimeType: string; fileName: string; size: number }>) => {
      if (!agentId) return;

      if (agentType === 'simple') {
        if (attachments && attachments.length > 0) {
          // AI SDK's sendMessage doesn't forward custom data to the server.
          // For multimodal messages, use direct fetch with SSE streaming.
          setAiMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'user' as const,
              parts: [{ type: 'text' as const, text: content }],
              createdAt: new Date(),
            } as UIMessage,
          ]);

          const assistantId = crypto.randomUUID();
          setAiMessages((prev) => [
            ...prev,
            {
              id: assistantId,
              role: 'assistant' as const,
              parts: [{ type: 'text' as const, text: '' }],
              createdAt: new Date(),
            } as UIMessage,
          ]);

          try {
            const res = await fetch(`/api/agents/${agentId}/playground`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: [
                  ...aiMessages.map((m) => ({
                    role: m.role,
                    content: m.parts?.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map((p) => p.text).join('') ?? '',
                  })),
                  {
                    role: 'user',
                    content,
                    data: { attachments },
                  },
                ],
                agentVersionId: versionId,
                alias,
                systemPrompt: overrides.systemPrompt,
                model: overrides.model,
                temperature: overrides.temperature,
                maxTokens: overrides.maxTokens,
              }),
            });

            if (!res.ok || !res.body) {
              throw new Error('Failed to get response');
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split('\n');

              for (const line of lines) {
                if (line.startsWith('0:')) {
                  const text = JSON.parse(line.slice(2));
                  fullText += text;
                  setAiMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? { ...m, parts: [{ type: 'text' as const, text: fullText }] }
                        : m
                    )
                  );
                }
              }
            }
          } catch (err) {
            onError?.(err instanceof Error ? err : new Error(String(err)));
            setAiMessages((prev) => prev.filter((m) => m.id !== assistantId));
          }
        } else {
          sendMessage({ text: content });
        }
        return;
      }

      // Graph agent: SSE streaming with console event capture
      setIsGraphLoading(true);
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

      setGraphMessages((prev) => [...prev, userMessage]);

      const requestBody = {
        messages: [
          ...graphMessages.map((m) => ({
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
                  setGraphMessages((prev) => {
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
            } else {
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

        // Ensure assistant message exists
        if (fullText) {
          setGraphMessages((prev) => {
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
        setIsGraphLoading(false);
      }
    },
    [agentId, agentType, versionId, alias, overrides, graphMessages, sendMessage, onError]
  );

  const handleRegenerate = useCallback(() => {
    if (!agentId) return;
    if (agentType === 'simple') {
      const lastUserMessage = aiMessages.filter((m) => m.role === 'user').pop();
      if (lastUserMessage) {
        const text = lastUserMessage.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('');
        sendMessage({ text });
      }
    } else {
      const lastUserMessage = graphMessages.filter((m) => m.role === 'user').pop();
      if (lastUserMessage) {
        const text = lastUserMessage.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('');
        handleSend(text);
      }
    }
  }, [agentId, agentType, aiMessages, graphMessages, sendMessage, handleSend]);

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

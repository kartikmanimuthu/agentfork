'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useChat, type UIMessage } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

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

export interface PlaygroundPauseInfo {
  prompt: string;
  resumeToken: string;
  executionId: string;
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
  const [executions, setExecutions] = useState<Array<{
    id: string;
    status: string;
    createdAt: string;
    output?: Record<string, unknown>;
    trace?: Record<string, unknown>;
  }>>([]);
  const [isGraphLoading, setIsGraphLoading] = useState(false);
  const [pauseInfo, setPauseInfo] = useState<PlaygroundPauseInfo | null>(null);

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
    messages,
    status,
    sendMessage,
    setMessages,
  } = useChat({
    transport,
    onError: (err) => {
      onError?.(err);
    },
  });

  // Load initial messages when provided
  useEffect(() => {
    if (initialMessages.length > 0) {
      setMessages(initialMessages);
    }
  }, [initialMessages, setMessages]);

  const isLoading = status === 'streaming' || status === 'submitted' || isGraphLoading;

  const readGraphStream = useCallback(
    async (res: Response, onPauseDetected?: (info: PlaygroundPauseInfo) => void) => {
      const executionId = res.headers.get('x-execution-id') ?? undefined;
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';
      const assistantMessageId = crypto.randomUUID();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));

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
              } else if (eventType === 'execution_paused' && data.resumeToken && executionId) {
                const info: PlaygroundPauseInfo = {
                  prompt: data.reason ?? data.prompt ?? '',
                  resumeToken: data.resumeToken,
                  executionId,
                };
                setPauseInfo(info);
                onPauseDetected?.(info);
              }
            } catch {
              // skip malformed events
            }
            eventType = '';
          }
        }
      }

      return { fullText, assistantMessageId, executionId };
    },
    [setMessages]
  );

  const handleSend = useCallback(
    async (content: string) => {
      if (!agentId) return;
      if (agentType === 'simple') {
        sendMessage({ text: content });
        return;
      }

      // Graph agent: SSE streaming
      setIsGraphLoading(true);
      setPauseInfo(null);
      try {
        const userMessage: PlaygroundMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          parts: [{ type: 'text' as const, text: content }],
        };
        setMessages((prev) => [...prev, userMessage]);

        const res = await fetch(`/api/agents/${agentId}/playground`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
          }),
        });

        if (!res.ok) {
          throw new Error('Failed to run agent');
        }

        const { fullText, assistantMessageId, executionId } = await readGraphStream(res);

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
        setIsGraphLoading(false);
      }
    },
    [agentType, agentId, versionId, alias, overrides, messages, sendMessage, setMessages, readGraphStream, onError]
  );

  const handleResume = useCallback(
    async (userInput: string) => {
      if (!pauseInfo) return;
      setIsGraphLoading(true);

      const userMessage: PlaygroundMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text' as const, text: userInput }],
      };
      setMessages((prev) => [...prev, userMessage]);
      setPauseInfo(null);

      try {
        const res = await fetch(`/api/agents/${agentId}/playground/resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resumeToken: pauseInfo.resumeToken,
            userInput,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? 'Failed to resume agent');
        }

        const { fullText, assistantMessageId, executionId } = await readGraphStream(res);

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
        setIsGraphLoading(false);
      }
    },
    [pauseInfo, agentId, setMessages, readGraphStream, onError]
  );

  const handleRegenerate = useCallback(() => {
    if (!agentId) return;
    if (agentType === 'simple') {
      const lastUserMessage = messages.filter((m) => m.role === 'user').pop();
      if (lastUserMessage) {
        const text = lastUserMessage.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('');
        sendMessage({ text });
      }
    }
  }, [agentId, agentType, messages, sendMessage]);

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
    pauseInfo,
    overrides,
    setOverrides,
    executions,
    refreshExecutions,
    handleSend,
    handleResume,
    handleRegenerate,
    setMessages,
  };
}

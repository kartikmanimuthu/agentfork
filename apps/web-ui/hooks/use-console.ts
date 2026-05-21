'use client';

import { useState, useMemo, useCallback } from 'react';
import type {
  ConsoleEvent,
  ConsoleTab,
  EventSeverity,
  MessageMetrics,
  SessionMetrics,
  RawData,
} from '@/lib/playground/types';

interface UseConsoleOptions {
  consoleEvents: ConsoleEvent[];
  messageMetrics: Map<string, MessageMetrics>;
  rawDataMap: Map<string, RawData>;
}

export function useConsole({ consoleEvents, messageMetrics, rawDataMap }: UseConsoleOptions) {
  const [activeTab, setActiveTab] = useState<ConsoleTab>('events');
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Set<EventSeverity>>(
    new Set(['info', 'warn', 'error'])
  );
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
    const avgLatencyMs =
      messageCount > 0
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

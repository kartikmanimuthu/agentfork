'use client';

import { useQuery } from '@tanstack/react-query';
import type { RunEvent } from './use-runs';
import { BASE_PATH } from '@/lib/base-path';

/** What one turn cost and how long it took. Nulls mean "not recorded", which is
 *  the honest answer for turns that predate metrics capture. */
export interface TurnMetrics {
  status: string;
  durationMs: number | null;
  usage: { inputTokens: number; outputTokens: number; modelCalls: number; modelMs: number } | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

/**
 * Metrics for every turn in the conversation, in one request.
 *
 * Keyed by runId, which is what each assistant message carries. One request for
 * the whole transcript rather than one per bubble — see the route's comment.
 */
export function useTurnMetrics(sessionId: string | null) {
  return useQuery({
    queryKey: ['chat', 'turns', sessionId],
    queryFn: async (): Promise<Record<string, TurnMetrics>> => {
      const res = await fetch(`${BASE_PATH}/api/chat/turns?sessionId=${encodeURIComponent(sessionId!)}`);
      if (!res.ok) return {};
      const body = (await res.json()) as { data?: { turns?: Record<string, TurnMetrics> } };
      return body.data?.turns ?? {};
    },
    enabled: Boolean(sessionId),
    // Metrics only change when a turn finishes, and the chat stream already
    // re-renders on that — so no polling. `sendMessage` invalidates this instead.
    staleTime: 30_000,
  });
}

/**
 * The recorded process behind one past turn — tool calls, thinking, results.
 *
 * Fetched only when a turn is expanded (`enabled`), because this is the expensive
 * half: a turn's timeline is far larger than its metrics and most are never looked
 * at. For the turn currently streaming, the live SSE events are used instead and
 * this is never called.
 */
export function useTurnProcess(runId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['chat', 'turn-process', runId],
    queryFn: async (): Promise<RunEvent[]> => {
      const res = await fetch(`${BASE_PATH}/api/runs/${runId}`);
      if (!res.ok) return [];
      const body = (await res.json()) as { data?: { events?: RunEvent[] } };
      return body.data?.events ?? [];
    },
    enabled: Boolean(runId) && enabled,
    // A finished turn's timeline is immutable, so once fetched it never needs
    // refetching for the life of the page.
    staleTime: Infinity,
  });
}

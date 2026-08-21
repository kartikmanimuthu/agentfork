'use client';

import { useState } from 'react';
import { Check, ChevronRight, Loader2 } from 'lucide-react';
import { AgentSteps, summaryFragments } from './agent-steps';
import { useTurnProcess, type TurnMetrics } from '@/hooks/use-chat-turns';
import type { RunEvent } from '@/hooks/use-runs';
import { cn } from '@/lib/utils';

/**
 * The process, cost and timing behind one assistant turn — all of it in the steps
 * bar, none of it under the answer.
 *
 * Two sources of the same process, chosen by whether the turn is happening now:
 *
 *  - LIVE (or recovered-and-still-running): the events already in memory, streamed
 *    over SSE. Rendered immediately, no fetch.
 *  - HISTORY: nothing is in memory, but the message carries a `runId`. The timeline
 *    is fetched only when the bar is expanded, because a long conversation's full
 *    set of tool calls is large and mostly never read.
 *
 * The response time comes from the batched per-conversation request either way, so
 * it shows without expanding anything. Tokens are deliberately not shown, and the
 * clock time lives under the answer rather than in this bar.
 */
export function TurnDetails({
  liveEvents,
  isLive,
  runId,
  metrics,
}: {
  liveEvents: RunEvent[];
  isLive: boolean;
  runId?: string;
  metrics?: TurnMetrics;
}) {
  const [expanded, setExpanded] = useState(false);
  // Only ever fetched for a turn with no live events — otherwise the in-memory ones
  // are authoritative and identical (the live stream sends the persisted rows).
  const needsFetch = liveEvents.length === 0 && Boolean(runId);
  const { data: fetched, isFetching } = useTurnProcess(runId, needsFetch && expanded);
  const fetchedEvents = fetched ?? [];

  // Live, or a history turn already expanded: hand the real events to AgentSteps,
  // which renders its own bar with the metrics folded into the summary.
  if (liveEvents.length > 0 || isLive) {
    return <AgentSteps events={liveEvents} isLive={isLive} metrics={metrics} />;
  }
  if (expanded && fetchedEvents.length > 0) {
    return <AgentSteps events={fetchedEvents} isLive={false} metrics={metrics} />;
  }

  // History, not yet expanded (or fetched and genuinely stepless). The step counts
  // are unknown until the fetch, so the bar shows what IS known — the duration —
  // through the same `summaryFragments` the real bar uses, so the two read
  // identically rather than being two layouts for one number.
  const summary = summaryFragments({ metrics });
  const hasAnything = summary.length > 0 || needsFetch;
  if (!hasAnything) return null;

  return (
    <div className="mb-3 w-full overflow-hidden rounded-xl border bg-muted/30">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={!needsFetch}
        data-testid="toggle-turn-process"
        aria-expanded={expanded}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors',
          needsFetch && 'hover:bg-muted/50 hover:text-foreground',
        )}
      >
        {needsFetch ? (
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', expanded && 'rotate-90')} />
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" />
        )}
        {isFetching ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        )}
        <span className="font-medium">Steps</span>
        <span className="truncate font-normal tabular-nums">{summary}</span>
      </button>

      {/* Expanded but nothing came back: a plain answer with no tool calls is a real
          outcome, and saying so beats an empty panel that reads as broken. */}
      {expanded && !isFetching && fetchedEvents.length === 0 && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          No tool calls or intermediate steps were recorded for this turn.
        </p>
      )}
    </div>
  );
}

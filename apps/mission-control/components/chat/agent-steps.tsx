'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Copy, ListChecks, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { describeTool } from './activity-summary';
import type { RunEvent } from '@/hooks/use-runs';

/**
 * The agent's work, shown rather than summarised away.
 *
 * This replaces ThoughtProcess, which mapped node names — `planner`,
 * `evaluator`, `reflect`, `generate` — from the hand-written StateGraph that the
 * DeepAgents migration deleted. Every lookup missed, so every step rendered as
 * the fallback "Working on it / Looking something up". The panel was not vague
 * by design any more; it was showing placeholder text for a graph that no longer
 * exists.
 *
 * The real tool name, its arguments and its output were already arriving over
 * SSE (`deriveNodeEvents` puts `toolArgs` on the draft and the route spreads
 * it) and were simply being discarded. Now they are shown, with the friendly
 * phrasing kept as a subtitle rather than as a replacement.
 */

/** The SSE payload carries toolArgs; the shared RunEvent type predates it. */
type StepEvent = RunEvent & { toolArgs?: unknown };

interface ToolStep {
  kind: 'tool';
  id: string;
  name: string;
  args?: unknown;
  output?: string;
  isError: boolean;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  endedAt?: number;
}

interface PlanStep {
  kind: 'plan';
  id: string;
  plan: Array<{ step: string; status: string }>;
  startedAt: number;
}

type Step = ToolStep | PlanStep;

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Date.now();
}

/**
 * Pairs each `tool_call` with the `tool_result` that follows it. Matching is by
 * tool name against the most recent still-running call, because the event
 * stream carries no correlation id.
 */
export function buildSteps(events: StepEvent[]): Step[] {
  const steps: Step[] = [];

  // Positional, so a repeated or missing server id can never collide. Event ids
  // arrive from the SSE stream and a turn spans multiple requests, so uniqueness
  // across the whole list is not something this component can assume.
  const keyAt = (i: number, event: StepEvent) => `${i}-${event.id ?? 'evt'}`;

  events.forEach((event, i) => {
    const at = ms(event.createdAt);

    if (event.eventType === 'tool_call') {
      steps.push({
        kind: 'tool',
        id: keyAt(i, event),
        name: event.toolName ?? 'unknown_tool',
        args: event.toolArgs,
        isError: false,
        status: 'running',
        startedAt: at,
      });
      return;
    }

    if (event.eventType === 'tool_result') {
      const match = [...steps]
        .reverse()
        .find((s): s is ToolStep => s.kind === 'tool' && s.status === 'running' && s.name === event.toolName);
      const isError = Boolean((event.metadata as { isError?: boolean } | null)?.isError);
      if (match) {
        match.output = event.toolOutput ?? '';
        match.isError = isError;
        match.status = isError ? 'error' : 'done';
        match.endedAt = at;
      }
      return;
    }

    const plan = (event.metadata as { plan?: Array<{ step: string; status: string }> } | null)?.plan;
    if (plan?.length) {
      steps.push({ kind: 'plan', id: keyAt(i, event), plan, startedAt: at });
      return;
    }

    // The model's PROSE is deliberately not a step.
    //
    // `deriveNodeEvents` emits the assistant's text as a `node_complete`, which is
    // right for the /runs timeline (where there is no answer rendered anywhere else)
    // but wrong here: chat already renders that text in full, below this panel, as
    // the answer. Showing it inside the timeline duplicated every reply — and worse,
    // it appeared the moment the model spoke, which on a turn that speaks and THEN
    // calls a tool meant the user read "I've updated your identity" while the write
    // was still running. It looked like the agent had claimed success prematurely
    // when in fact the turn had not finished.
    //
    // Tool calls, results and plans still render; only the narration is dropped.
  });

  // `write_todos` produces BOTH a tool call and the plan itself. Showing both
  // means a meaningless "write_todos" row immediately above the plan it wrote,
  // so once the plan is present the raw call is redundant — but if the todos
  // channel never arrived, the tool row is all we have and must be kept.
  if (steps.some((s) => s.kind === 'plan')) {
    return steps.filter((s) => !(s.kind === 'tool' && s.name === 'write_todos'));
  }

  return steps;
}

/** Pretty-print args/JSON output; fall back to the raw string when it isn't JSON. */
function pretty(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function StepIcon({ step }: { step: Step }) {
  if (step.kind === 'plan') return <ListChecks className="h-3.5 w-3.5 text-blue-500" />;
  if (step.status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
  if (step.status === 'error') return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  return <Check className="h-3.5 w-3.5 text-emerald-500" />;
}

function Payload({ label, body, tone }: { label: string; body: string; tone: 'plain' | 'error' }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">{label}</div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(body);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute right-1 top-4 z-10 rounded bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover/payload:opacity-100"
        aria-label={`Copy ${label}`}
      >
        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      </button>
      <pre
        className={cn(
          'max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md border p-2 font-mono text-[11px] leading-relaxed',
          tone === 'error'
            ? 'border-destructive/40 bg-destructive/5 text-destructive'
            : 'bg-background/60 text-muted-foreground',
        )}
      >
        {body}
      </pre>
    </div>
  );
}

function ToolDetail({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const args = pretty(step.args);
  const output = step.output ?? '';
  if (!args && !output) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open && (
        <div className="group/payload mt-1.5 space-y-2">
          {args && <Payload label="Arguments" body={args} tone="plain" />}
          {output && <Payload label={step.isError ? 'Error' : 'Result'} body={output} tone={step.isError ? 'error' : 'plain'} />}
        </div>
      )}
    </div>
  );
}

/**
 * What the turn cost, rendered in this bar rather than under the answer.
 *
 * Kept as a prop rather than fetched here: `AgentSteps` is a pure view over
 * `events`, and the numbers come from the run record via one batched request per
 * conversation (see use-chat-turns.ts).
 */
export interface StepsMetrics {
  durationMs: number | null;
}

/** Formats a duration the way a reader scans it, not the way it is stored. */
function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

/**
 * The counts and elapsed time for one turn, as `·`-joined summary fragments.
 *
 * Shared so the collapsed history bar in `TurnDetails` — which has the duration but
 * has not fetched the steps yet — reads identically to this one instead of inventing
 * a second layout for the same numbers.
 *
 * No token counts: they were dropped as noise for a reader who wants to know what
 * happened, not what it cost. No clock time either — that belongs under the answer,
 * next to the user's own message timestamp, so the two line up down the transcript.
 */
export function summaryFragments(input: {
  stepCount?: number;
  toolCount?: number;
  failedCount?: number;
  metrics?: StepsMetrics;
}): string {
  const { stepCount, toolCount, failedCount, metrics } = input;
  return [
    stepCount ? `${stepCount} step${stepCount === 1 ? '' : 's'}` : null,
    toolCount ? `${toolCount} tool${toolCount === 1 ? '' : 's'}` : null,
    failedCount ? `${failedCount} failed` : null,
    // The run's OWN wall clock, not the span of the derived steps. The two differ by
    // whatever the model spent before the first step and after the last — 34.3s vs
    // 48.8s on one observed turn — and showing the step span while calling it the
    // response time was actively misleading.
    metrics?.durationMs != null ? formatDuration(metrics.durationMs) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function AgentSteps({
  events,
  isLive,
  metrics,
}: {
  events: StepEvent[];
  isLive: boolean;
  metrics?: StepsMetrics;
}) {
  const steps = useMemo(() => buildSteps(events), [events]);

  // Open while working so progress is visible, then collapse on completion so a
  // finished transcript stays readable. Still toggleable at any time.
  const [open, setOpen] = useState(isLive);
  const wasLive = useRef(isLive);
  useEffect(() => {
    if (wasLive.current && !isLive) setOpen(false);
    wasLive.current = isLive;
  }, [isLive]);

  if (steps.length === 0) {
    return isLive ? (
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Thinking…
      </div>
    ) : null;
  }

  const tools = steps.filter((s): s is ToolStep => s.kind === 'tool');
  const failed = tools.filter((t) => t.status === 'error').length;
  // Counts, cost and clock time in ONE place: this bar. They used to sit under the
  // answer while the bar carried a different, disagreeing duration — and per-step
  // timings made it four times on one turn. Step timings are still recorded on
  // every ClawRunEvent, so restoring those is a render change, not a data change.
  const summary = summaryFragments({
    stepCount: steps.length,
    toolCount: tools.length,
    failedCount: failed,
    metrics,
  });

  return (
    <div className="mb-3 w-full overflow-hidden rounded-xl border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
        {isLive ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
        ) : failed ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        )}
        <span className="font-medium">{isLive ? 'Working' : 'Steps'}</span>
        <span className="truncate font-normal tabular-nums">{summary}</span>
      </button>

      {open && (
        <ol className="space-y-0 border-t px-3 py-2">
          {steps.map((step, i) => {
            const last = i === steps.length - 1;
            return (
              <li key={step.id} className="flex gap-2.5">
                <div className="flex flex-col items-center">
                  <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center">
                    <StepIcon step={step} />
                  </span>
                  {!last && <span className="my-0.5 w-px flex-1 bg-border" />}
                </div>

                <div className={cn('min-w-0 flex-1', last ? 'pb-1' : 'pb-3')}>
                  {step.kind === 'tool' && (
                    <>
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                          {step.name}
                        </code>
                        <span className="text-xs text-muted-foreground">{describeTool(step.name)}</span>
                      </div>
                      <ToolDetail step={step} />
                    </>
                  )}

                  {step.kind === 'plan' && (
                    <div>
                      <p className="mb-1 text-xs font-medium text-foreground">Plan</p>
                      <ul className="space-y-0.5">
                        {step.plan.map((p, idx) => (
                          <li key={idx} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <span
                              className={cn(
                                'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                                p.status === 'completed' ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                              )}
                            />
                            <span className={cn(p.status === 'completed' && 'line-through opacity-60')}>{p.step}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

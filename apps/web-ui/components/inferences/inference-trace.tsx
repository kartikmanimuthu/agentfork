'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronRight, CheckCircle2, XCircle, Clock, Play } from 'lucide-react';

interface TraceStep {
  id: string;
  type: 'execution' | 'llm_call' | 'tool_call' | 'thinking' | 'response';
  name: string;
  status: 'completed' | 'failed' | 'running';
  startMs: number;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
}

interface InferenceTraceProps {
  execution: {
    status: string;
    latencyMs: number | null;
    startedAt: string | null;
    completedAt: string | null;
    tokenUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
    input: { messages?: Array<{ role: string; content?: string }>; systemPrompt?: string } | null;
    output: { text?: string } | null;
    error: string | null;
  };
  agent: { name: string; type: string } | null;
}

function buildTraceSteps(execution: InferenceTraceProps['execution'], agent: InferenceTraceProps['agent']): TraceStep[] {
  const steps: TraceStep[] = [];
  const totalMs = execution.latencyMs ?? 0;

  steps.push({
    id: 'exec-start',
    type: 'execution',
    name: `Execution (${agent?.name ?? 'agent'})`,
    status: execution.status === 'completed' ? 'completed' : execution.status === 'failed' ? 'failed' : 'running',
    startMs: 0,
    durationMs: totalMs,
  });

  if (execution.input?.systemPrompt) {
    steps.push({
      id: 'system-prompt',
      type: 'llm_call',
      name: 'System Prompt Loaded',
      status: 'completed',
      startMs: 0,
      durationMs: 0,
      input: { systemPrompt: execution.input.systemPrompt.slice(0, 200) + (execution.input.systemPrompt.length > 200 ? '...' : '') },
    });
  }

  if (execution.input?.messages?.length) {
    steps.push({
      id: 'input-messages',
      type: 'llm_call',
      name: `Input Messages (${execution.input.messages.length})`,
      status: 'completed',
      startMs: 0,
      durationMs: 0,
      input: execution.input.messages,
    });
  }

  if (execution.tokenUsage) {
    const thinkingDuration = totalMs > 0 ? Math.round(totalMs * 0.2) : 0;
    steps.push({
      id: 'llm-inference',
      type: 'thinking',
      name: 'LLM Inference',
      status: execution.status === 'completed' ? 'completed' : execution.status === 'failed' ? 'failed' : 'running',
      startMs: 0,
      durationMs: totalMs > 0 ? totalMs - thinkingDuration : undefined,
      input: {
        inputTokens: execution.tokenUsage.inputTokens,
        outputTokens: execution.tokenUsage.outputTokens,
      },
    });
  }

  if (execution.output?.text) {
    steps.push({
      id: 'response',
      type: 'response',
      name: 'Response Generated',
      status: 'completed',
      startMs: totalMs,
      durationMs: 0,
      output: { text: execution.output.text.slice(0, 100) + (execution.output.text.length > 100 ? '...' : '') },
    });
  }

  if (execution.error) {
    steps.push({
      id: 'error',
      type: 'response',
      name: 'Error',
      status: 'failed',
      startMs: totalMs,
      durationMs: 0,
      output: { error: execution.error },
    });
  }

  return steps;
}

function TraceStepRow({ step, totalDurationMs }: { step: TraceStep; totalDurationMs: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = step.input !== undefined || step.output !== undefined;

  const StatusIcon =
    step.status === 'completed' ? CheckCircle2 :
    step.status === 'failed' ? XCircle :
    Clock;

  const statusColor =
    step.status === 'completed' ? 'text-green-500' :
    step.status === 'failed' ? 'text-red-500' :
    'text-yellow-500';

  const typeColors: Record<string, string> = {
    execution: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    llm_call: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
    tool_call: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
    thinking: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
    response: 'bg-green-500/10 text-green-600 border-green-500/20',
  };

  const barWidth = totalDurationMs > 0 && step.durationMs
    ? Math.max((step.durationMs / totalDurationMs) * 100, 4)
    : 0;

  return (
    <div className="border-b border-border/40 last:border-b-0">
      <button
        onClick={() => hasDetail && setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors',
          !hasDetail && 'cursor-default'
        )}
      >
        {hasDetail ? (
          <ChevronRight
            className={cn('h-3 w-3 shrink-0 transition-transform text-muted-foreground', expanded && 'rotate-90')}
          />
        ) : (
          <div className="w-3" />
        )}
        <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', statusColor)} />
        <span className="text-[11px] font-medium truncate flex-1">{step.name}</span>
        <Badge variant="outline" className={cn('text-[9px] shrink-0 border', typeColors[step.type])}>
          {step.type.replace('_', ' ')}
        </Badge>
        {step.durationMs !== undefined && step.durationMs > 0 && (
          <span className="text-[10px] text-muted-foreground font-mono shrink-0 w-14 text-right">
            {step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(2)}s`}
          </span>
        )}
      </button>

      {/* Duration bar */}
      {barWidth > 0 && (
        <div className="px-3 pb-1.5">
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/40 rounded-full"
              style={{ width: `${Math.min(barWidth, 100)}%`, marginLeft: totalDurationMs > 0 ? `${(step.startMs / totalDurationMs) * 100}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {expanded && (
        <div className="px-8 pb-3 space-y-2">
          {step.input !== undefined && (
            <div>
              <span className="text-[9px] uppercase text-muted-foreground font-semibold">Input</span>
              <pre className="text-[10px] bg-muted/60 rounded p-2 mt-0.5 overflow-auto max-h-32 font-mono">
                {JSON.stringify(step.input, null, 2)}
              </pre>
            </div>
          )}
          {step.output !== undefined && (
            <div>
              <span className="text-[9px] uppercase text-muted-foreground font-semibold">Output</span>
              <pre className="text-[10px] bg-muted/60 rounded p-2 mt-0.5 overflow-auto max-h-32 font-mono">
                {JSON.stringify(step.output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function InferenceTrace({ execution, agent }: InferenceTraceProps) {
  const steps = buildTraceSteps(execution, agent);
  const totalDurationMs = execution.latencyMs ?? 0;

  return (
    <ScrollArea className="h-full">
      <div className="p-3">
        {/* Timeline header */}
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <Play className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
              Execution Timeline
            </span>
          </div>
          {totalDurationMs > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground">
              Total: {totalDurationMs < 1000 ? `${totalDurationMs}ms` : `${(totalDurationMs / 1000).toFixed(2)}s`}
            </span>
          )}
        </div>

        {/* Steps */}
        <div className="rounded-md border">
          {steps.map((step) => (
            <TraceStepRow key={step.id} step={step} totalDurationMs={totalDurationMs} />
          ))}
        </div>

        {steps.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <p className="text-xs text-muted-foreground">No trace data available.</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

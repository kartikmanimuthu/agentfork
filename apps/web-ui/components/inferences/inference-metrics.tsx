'use client';

import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Zap, Coins, Clock, Hash, Cpu, TrendingUp, ArrowRight } from 'lucide-react';

interface InferenceMetricsProps {
  execution: {
    latencyMs: number | null;
    tokenUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
    cacheHit: boolean;
    startedAt: string | null;
    completedAt: string | null;
  };
  agent: { name: string; type: string } | null;
}

function MetricRow({
  icon: Icon,
  label,
  value,
  subValue,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  subValue?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <div className="text-right">
        <span className="text-[11px] font-medium">{value}</span>
        {subValue && <span className="text-[10px] text-muted-foreground ml-1.5">({subValue})</span>}
      </div>
    </div>
  );
}

function TokenBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="px-3 py-1.5">
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium font-mono">{value.toLocaleString()}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

function estimateCost(tokenUsage: { inputTokens?: number; outputTokens?: number } | null): {
  input: number;
  output: number;
  total: number;
} {
  if (!tokenUsage) return { input: 0, output: 0, total: 0 };
  const inputCost = ((tokenUsage.inputTokens ?? 0) / 1_000_000) * 3.0;
  const outputCost = ((tokenUsage.outputTokens ?? 0) / 1_000_000) * 15.0;
  return { input: inputCost, output: outputCost, total: inputCost + outputCost };
}

export function InferenceMetrics({ execution, agent }: InferenceMetricsProps) {
  const tokens = execution.tokenUsage;
  const inputTokens = tokens?.inputTokens ?? 0;
  const outputTokens = tokens?.outputTokens ?? 0;
  const totalTokens = tokens?.totalTokens ?? inputTokens + outputTokens;
  const maxTokens = Math.max(inputTokens, outputTokens, 1);
  const cost = estimateCost(tokens);

  const latencyMs = execution.latencyMs ?? 0;
  const throughput = latencyMs > 0 && outputTokens > 0
    ? Math.round((outputTokens / latencyMs) * 1000)
    : null;

  return (
    <ScrollArea className="h-full">
      <div className="py-3 space-y-1">
        {/* Token Breakdown */}
        <div className="px-3 pb-1">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
            Token Usage
          </span>
        </div>

        <div className="space-y-0.5">
          <TokenBar label="Input tokens" value={inputTokens} max={maxTokens} color="bg-blue-500" />
          <TokenBar label="Output tokens" value={outputTokens} max={maxTokens} color="bg-green-500" />
        </div>

        <div className="border-t mx-3 my-2" />

        <MetricRow icon={Hash} label="Total tokens" value={totalTokens.toLocaleString()} />

        {/* Performance */}
        <div className="px-3 pt-3 pb-1">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
            Performance
          </span>
        </div>

        <MetricRow
          icon={Clock}
          label="Latency"
          value={
            latencyMs === 0
              ? '—'
              : latencyMs < 1000
                ? `${Math.round(latencyMs)}ms`
                : `${(latencyMs / 1000).toFixed(2)}s`
          }
        />
        {throughput !== null && (
          <MetricRow
            icon={TrendingUp}
            label="Throughput"
            value={`${throughput} tok/s`}
          />
        )}
        <MetricRow
          icon={Zap}
          label="Cache"
          value={execution.cacheHit ? 'Hit' : 'Miss'}
        />

        {/* Cost */}
        <div className="px-3 pt-3 pb-1">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
            Cost Estimate
          </span>
        </div>

        <MetricRow
          icon={Coins}
          label="Total cost"
          value={`$${cost.total.toFixed(4)}`}
        />
        <div className="px-3 py-1">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>Input: ${cost.input.toFixed(4)}</span>
            <ArrowRight className="h-2.5 w-2.5" />
            <span>Output: ${cost.output.toFixed(4)}</span>
          </div>
        </div>

        {/* Model Info */}
        {agent && (
          <>
            <div className="px-3 pt-3 pb-1">
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
                Model
              </span>
            </div>
            <MetricRow icon={Cpu} label="Agent" value={agent.name} />
            <MetricRow icon={Cpu} label="Type" value={agent.type} />
          </>
        )}
      </div>
    </ScrollArea>
  );
}

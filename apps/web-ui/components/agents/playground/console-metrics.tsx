'use client';

import { cn } from '@/lib/utils';
import { Zap, Coins, Clock, Hash, TrendingUp, Cpu } from 'lucide-react';
import type { MessageMetrics, SessionMetrics } from '@/lib/playground/types';

interface ConsoleMetricsProps {
  selectedMetrics: MessageMetrics | null;
  sessionMetrics: SessionMetrics;
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
    <div className="px-3 py-1">
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value.toLocaleString()}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full', color)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

function PerMessageView({ metrics }: { metrics: MessageMetrics }) {
  const maxTokens = Math.max(metrics.inputTokens, metrics.outputTokens, metrics.thinkingTokens, 1);

  return (
    <div className="space-y-1">
      <div className="px-3 pt-2 pb-1">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
          Per-Message Metrics
        </span>
      </div>

      <div className="space-y-0.5">
        <TokenBar label="Input tokens" value={metrics.inputTokens} max={maxTokens} color="bg-blue-500" />
        <TokenBar
          label="Output tokens"
          value={metrics.outputTokens}
          max={maxTokens}
          color="bg-green-500"
        />
        {metrics.thinkingTokens > 0 && (
          <TokenBar
            label="Thinking tokens"
            value={metrics.thinkingTokens}
            max={maxTokens}
            color="bg-purple-500"
          />
        )}
      </div>

      <div className="border-t mt-2 pt-1">
        <MetricRow icon={Hash} label="Total tokens" value={metrics.totalTokens.toLocaleString()} />
        <MetricRow icon={Zap} label="Time to first token" value={`${metrics.ttftMs}ms`} />
        <MetricRow
          icon={Clock}
          label="Total generation"
          value={
            metrics.durationMs < 1000
              ? `${metrics.durationMs}ms`
              : `${(metrics.durationMs / 1000).toFixed(1)}s`
          }
        />
        <MetricRow
          icon={Cpu}
          label="Model"
          value={metrics.model.split('/').pop()?.split(':')[0] ?? metrics.model}
        />
        <MetricRow
          icon={Coins}
          label="Cost estimate"
          value={`$${metrics.costEstimate.total.toFixed(4)}`}
          subValue={`in: $${metrics.costEstimate.input.toFixed(4)} / out: $${metrics.costEstimate.output.toFixed(4)}`}
        />
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
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
          Session Metrics
        </span>
      </div>

      <MetricRow icon={Hash} label="Total tokens" value={metrics.totalTokens.toLocaleString()} />
      <MetricRow icon={Coins} label="Total cost" value={`$${metrics.totalCost.toFixed(4)}`} />
      <MetricRow icon={TrendingUp} label="Messages" value={String(metrics.messageCount)} />
      <MetricRow
        icon={Hash}
        label="Avg tokens/msg"
        value={Math.round(metrics.avgTokensPerMessage).toLocaleString()}
      />
      <MetricRow
        icon={Clock}
        label="Avg latency"
        value={
          metrics.avgLatencyMs < 1000
            ? `${Math.round(metrics.avgLatencyMs)}ms`
            : `${(metrics.avgLatencyMs / 1000).toFixed(1)}s`
        }
      />

      {/* Latency sparkline */}
      {metrics.latencyByMessage.length > 1 && (
        <div className="px-3 pt-2">
          <span className="text-[10px] text-muted-foreground">Latency trend</span>
          <div className="flex items-end gap-0.5 h-8 mt-1">
            {metrics.latencyByMessage.map((m) => (
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

'use client';

import { Zap, Coins, Cpu } from 'lucide-react';
import type { MessageMetrics } from '@/lib/playground/types';

interface MessageMetadataBarProps {
  metrics: MessageMetrics | undefined;
  isStreaming?: boolean;
  elapsedMs?: number;
}

export function MessageMetadataBar({ metrics, isStreaming, elapsedMs }: MessageMetadataBarProps) {
  if (!metrics && !isStreaming) return null;

  if (isStreaming) {
    return (
      <div className="flex items-center gap-3 mt-1.5 pt-1.5 border-t border-border/50 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          Generating...
        </span>
        {elapsedMs !== undefined && (
          <span className="flex items-center gap-1">
            <Zap className="h-2.5 w-2.5" />
            {(elapsedMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="flex items-center gap-3 mt-1.5 pt-1.5 border-t border-border/50 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1" title="Total latency">
        <Zap className="h-2.5 w-2.5" />
        {metrics.durationMs < 1000
          ? `${metrics.durationMs}ms`
          : `${(metrics.durationMs / 1000).toFixed(1)}s`}
      </span>
      <span className="flex items-center gap-1" title="Total tokens">
        <Coins className="h-2.5 w-2.5" />
        {metrics.totalTokens.toLocaleString()} tokens
      </span>
      <span className="flex items-center gap-1" title="Model">
        <Cpu className="h-2.5 w-2.5" />
        {metrics.model.split('/').pop()?.split(':')[0] ?? metrics.model}
      </span>
      {metrics.costEstimate.total > 0 && (
        <span className="text-[10px]" title="Estimated cost">
          ${metrics.costEstimate.total.toFixed(4)}
        </span>
      )}
    </div>
  );
}

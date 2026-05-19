'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { Timer } from 'lucide-react';
import type { DelayNodeConfig } from '@chatbot/agent-studio';

export interface DelayNodeData extends Record<string, unknown> {
  label: string;
  config: DelayNodeConfig;
  selected?: boolean;
}

function formatDelay(ms: number): string {
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  if (ms >= 1000) return `${Math.round(ms / 1000)}s`;
  return `${ms}ms`;
}

export const DelayNode = memo(function DelayNode({ data, selected }: NodeProps) {
  const nodeData = data as DelayNodeData;
  const config = nodeData.config as DelayNodeConfig;

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />

      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <Timer className="h-3.5 w-3.5 text-slate-500 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">Delay</Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground">
          {config.delayChannel ? `From channel: ${config.delayChannel}` : formatDelay(config.delayMs ?? 1000)}
        </p>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});

'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { Brain } from 'lucide-react';
import type { MemoryNodeConfig } from '@chatbot/agent-studio';

export interface MemoryNodeData extends Record<string, unknown> {
  label: string;
  config: MemoryNodeConfig;
  selected?: boolean;
}

export const MemoryNode = memo(function MemoryNode({ data, selected }: NodeProps) {
  const nodeData = data as MemoryNodeData;
  const config = nodeData.config as MemoryNodeConfig;

  const limitLabel = config.strategy === 'sliding_window' && config.maxMessages
    ? `last ${config.maxMessages}`
    : config.strategy === 'token_limit' && config.maxTokens
      ? `${config.maxTokens} tokens`
      : null;

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />

      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <Brain className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">Memory</Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground">
          {config.strategy.replace('_', ' ')}
        </p>
        {limitLabel && (
          <p className="text-[11px] text-muted-foreground">{limitLabel}</p>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});

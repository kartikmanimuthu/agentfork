'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { ArrowUpFromLine } from 'lucide-react';
import type { OutputNodeConfig } from '@chatbot/agent-studio';

export interface OutputNodeData extends Record<string, unknown> {
  label: string;
  config: OutputNodeConfig;
  selected?: boolean;
}

export const OutputNode = memo(function OutputNode({ data, selected }: NodeProps) {
  const nodeData = data as OutputNodeData;
  const config = nodeData.config as OutputNodeConfig;

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />

      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <ArrowUpFromLine className="h-3.5 w-3.5 text-red-500 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">Output</Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground truncate" title={config.responseChannel}>
          channel: {config.responseChannel}
        </p>
        <p className="text-[11px] text-muted-foreground">
          format: {config.format}
        </p>
      </div>
    </div>
  );
});

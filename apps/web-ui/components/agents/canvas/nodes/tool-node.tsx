'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { Wrench } from 'lucide-react';
import type { ToolNodeConfig } from '@chatbot/agent-studio';

export interface ToolNodeData extends Record<string, unknown> {
  label: string;
  config: ToolNodeConfig;
}

export const ToolNode = memo(function ToolNode({ data, selected }: NodeProps) {
  const nodeData = data as ToolNodeData;
  const config = nodeData.config as ToolNodeConfig;

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />

      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <Wrench className="h-3.5 w-3.5 text-orange-500 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0">Tool</Badge>
      </div>

      <div className="px-3 py-2">
        <p className="text-[11px] text-muted-foreground truncate" title={config.toolName}>
          {config.toolName || <span className="italic">No tool selected</span>}
        </p>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});

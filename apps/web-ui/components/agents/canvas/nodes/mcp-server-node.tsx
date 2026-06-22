'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { Plug } from 'lucide-react';
import type { McpServerNodeConfig } from '@chatbot/agent-studio';

export interface McpServerNodeData extends Record<string, unknown> {
  label: string;
  config: McpServerNodeConfig;
  selected?: boolean;
}

export const McpServerNode = memo(function McpServerNode({ data, selected }: NodeProps) {
  const nodeData = data as McpServerNodeData;
  const config = nodeData.config as McpServerNodeConfig;

  const rawLabel = config.serverName || config.serverId;
  const serverLabel = rawLabel.length > 20 ? `${rawLabel.slice(0, 20)}...` : rawLabel;

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />

      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <Plug className="h-3.5 w-3.5 text-cyan-500 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">MCP</Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground truncate">{serverLabel}</p>
        <p className="text-[11px] text-muted-foreground truncate">{config.toolName}</p>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});

'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';
import type { SubAgentNodeConfig } from '@chatbot/agent-studio';

export interface SubAgentNodeData extends Record<string, unknown> {
  label: string;
  config: SubAgentNodeConfig;
  selected?: boolean;
}

export const SubAgentNode = memo(function SubAgentNode({ data, selected }: NodeProps) {
  const nodeData = data as SubAgentNodeData;
  const config = nodeData.config as SubAgentNodeConfig;

  const displayName = config.alias || config.agentId?.slice(0, 20) || 'No agent';

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />

      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <Users className="h-3.5 w-3.5 text-rose-500 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">Sub-Agent</Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground truncate">{displayName}</p>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});

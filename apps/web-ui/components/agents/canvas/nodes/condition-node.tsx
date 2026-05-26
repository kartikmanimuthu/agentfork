'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { GitFork } from 'lucide-react';
import type { ConditionNodeConfig } from '@chatbot/agent-studio';

export interface ConditionNodeData extends Record<string, unknown> {
  label: string;
  config: ConditionNodeConfig;
  selected?: boolean;
}

export const ConditionNode = memo(function ConditionNode({ data, selected }: NodeProps) {
  const nodeData = data as ConditionNodeData;
  const config = nodeData.config as ConditionNodeConfig;

  const truncatedExpr = config.expression?.slice(0, 40) || 'No expression';

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />

      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <GitFork className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">Condition</Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground font-mono truncate">{truncatedExpr}</p>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        className="!bg-green-500 !left-[30%]"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        className="!bg-red-500 !left-[70%]"
      />
    </div>
  );
});

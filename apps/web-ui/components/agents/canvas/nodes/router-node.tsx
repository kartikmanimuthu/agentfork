'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { GitBranch } from 'lucide-react';
import type { RouterNodeConfig } from '@chatbot/agent-studio';

export interface RouterNodeData extends Record<string, unknown> {
  label: string;
  config: RouterNodeConfig;
}

export const RouterNode = memo(function RouterNode({ data, selected }: NodeProps) {
  const nodeData = data as RouterNodeData;
  const config = nodeData.config as RouterNodeConfig;
  const conditionCount = config.conditions?.length ?? 0;

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />

      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <GitBranch className="h-3.5 w-3.5 text-purple-500 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0 border-purple-300 text-purple-600">
          Router
        </Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground">
          {conditionCount} condition{conditionCount !== 1 ? 's' : ''}
        </p>
        {config.defaultTarget && (
          <p className="text-[11px] text-muted-foreground truncate">
            default → {config.defaultTarget}
          </p>
        )}
      </div>

      {/* Multiple source handles for each condition */}
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});

'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { Code } from 'lucide-react';
import type { CodeNodeConfig } from '@chatbot/agent-studio';

export interface CodeNodeData extends Record<string, unknown> {
  label: string;
  config: CodeNodeConfig;
  selected?: boolean;
}

export const CodeNode = memo(function CodeNode({ data, selected }: NodeProps) {
  const nodeData = data as CodeNodeData;
  const config = nodeData.config as CodeNodeConfig;

  const firstLine = config.code?.split('\n')[0]?.slice(0, 40) || 'No code';

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />

      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <Code className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">{config.language ?? 'JS'}</Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground font-mono truncate">{firstLine}</p>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});

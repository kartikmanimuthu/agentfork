'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { ArrowDownToLine } from 'lucide-react';
import type { InputNodeConfig } from '@chatbot/agent-studio';

export interface InputNodeData extends Record<string, unknown> {
  label: string;
  config: InputNodeConfig;
  selected?: boolean;
}

export const InputNode = memo(function InputNode({ data, selected }: NodeProps) {
  const nodeData = data as InputNodeData;
  const config = nodeData.config as InputNodeConfig;

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <ArrowDownToLine className="h-3.5 w-3.5 text-green-500 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">Input</Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground">
          mode: {config.mode}
        </p>
        {config.mode === 'structured' && config.inputSchema?.length && (
          <p className="text-[11px] text-muted-foreground">
            {config.inputSchema.length} field{config.inputSchema.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});

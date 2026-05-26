'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { Globe } from 'lucide-react';
import type { HttpNodeConfig } from '@chatbot/agent-studio';

export interface HttpNodeData extends Record<string, unknown> {
  label: string;
  config: HttpNodeConfig;
  selected?: boolean;
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green-100 text-green-700',
  POST: 'bg-blue-100 text-blue-700',
  PUT: 'bg-amber-100 text-amber-700',
  PATCH: 'bg-orange-100 text-orange-700',
  DELETE: 'bg-red-100 text-red-700',
};

export const HttpNode = memo(function HttpNode({ data, selected }: NodeProps) {
  const nodeData = data as HttpNodeData;
  const config = nodeData.config as HttpNodeConfig;

  const methodColor = METHOD_COLORS[config.method] ?? 'bg-muted text-muted-foreground';
  const truncatedUrl = config.url?.slice(0, 35) || 'No URL';

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />

      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <Globe className="h-3.5 w-3.5 text-blue-500 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge className={`ml-auto text-[10px] px-1.5 py-0 ${methodColor}`}>{config.method}</Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground font-mono truncate">{truncatedUrl}</p>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});

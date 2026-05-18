'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { BookOpen } from 'lucide-react';
import type { KnowledgeBaseNodeConfig } from '@chatbot/agent-studio';

export interface KnowledgeBaseNodeData extends Record<string, unknown> {
  label: string;
  config: KnowledgeBaseNodeConfig;
  selected?: boolean;
}

export const KnowledgeBaseNode = memo(function KnowledgeBaseNode({ data, selected }: NodeProps) {
  const nodeData = data as KnowledgeBaseNodeData;
  const config = nodeData.config as KnowledgeBaseNodeConfig;

  const kbLabel = config.knowledgeBaseIds.length > 0
    ? `${config.knowledgeBaseIds.length} KB${config.knowledgeBaseIds.length > 1 ? 's' : ''}`
    : 'Agent KBs';

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />

      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <BookOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">KB</Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground">{kbLabel}</p>
        <p className="text-[11px] text-muted-foreground">top {config.topK}</p>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});

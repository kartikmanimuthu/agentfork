'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { Bot } from 'lucide-react';
import type { LlmNodeConfig } from '@chatbot/agent-studio';

export interface LlmNodeData extends Record<string, unknown> {
  label: string;
  config: LlmNodeConfig;
  selected?: boolean;
}

export const LlmNode = memo(function LlmNode({ data, selected }: NodeProps) {
  const nodeData = data as LlmNodeData;
  const config = nodeData.config as LlmNodeConfig;
  const modelShort = config.model?.split('.').pop() ?? config.model ?? '—';

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />

      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <Bot className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">LLM</Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground truncate" title={config.model}>
          {modelShort}
        </p>
        {config.temperature !== undefined && (
          <p className="text-[11px] text-muted-foreground">
            temp: {config.temperature}
          </p>
        )}
        {config.mcpServerIds && config.mcpServerIds.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {config.mcpServerIds.length} MCP server{config.mcpServerIds.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});

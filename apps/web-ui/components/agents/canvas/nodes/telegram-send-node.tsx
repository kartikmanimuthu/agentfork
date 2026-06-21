'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { Send } from 'lucide-react';
import type { TelegramSendNodeConfig } from '@chatbot/agent-studio';

export interface TelegramSendNodeData extends Record<string, unknown> {
  label: string;
  config: TelegramSendNodeConfig;
  selected?: boolean;
}

export const TelegramSendNode = memo(function TelegramSendNode({ data, selected }: NodeProps) {
  const nodeData = data as TelegramSendNodeData;

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <Send className="h-3.5 w-3.5 text-sky-600 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">TG Send</Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground truncate">{nodeData.config.messageChannel ?? 'No channel configured'}</p>
      </div>

      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});

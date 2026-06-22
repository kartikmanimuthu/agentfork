'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { Send } from 'lucide-react';
import type { TelegramTriggerNodeConfig } from '@chatbot/agent-studio';

export interface TelegramTriggerNodeData extends Record<string, unknown> {
  label: string;
  config: TelegramTriggerNodeConfig;
  selected?: boolean;
}

export const TelegramTriggerNode = memo(function TelegramTriggerNode({ data, selected }: NodeProps) {
  const nodeData = data as TelegramTriggerNodeData;

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <Send className="h-3.5 w-3.5 text-sky-600 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">TG Trigger</Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground">tg_chat_id</p>
        <p className="text-[11px] text-muted-foreground">tg_text</p>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});

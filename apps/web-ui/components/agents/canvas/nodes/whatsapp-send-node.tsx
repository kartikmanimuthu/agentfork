'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';
import type { WhatsAppSendNodeConfig } from '@chatbot/agent-studio';

export interface WhatsAppSendNodeData extends Record<string, unknown> {
  label: string;
  config: WhatsAppSendNodeConfig;
  selected?: boolean;
}

export const WhatsAppSendNode = memo(function WhatsAppSendNode({ data, selected }: NodeProps) {
  const nodeData = data as WhatsAppSendNodeData;
  const config = nodeData.config as WhatsAppSendNodeConfig;

  return (
    <div
      className={`min-w-[180px] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-md'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />

      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
        <WhatsAppIcon className="h-3.5 w-3.5 text-green-600 shrink-0" />
        <span className="text-xs font-semibold truncate">{nodeData.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">WA Send</Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground">
          type: {config.messageType ?? 'text'}
        </p>
        <p className="text-[11px] text-muted-foreground truncate" title={config.messageChannel}>
          ch: {config.messageChannel ?? 'llm_output'}
        </p>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});

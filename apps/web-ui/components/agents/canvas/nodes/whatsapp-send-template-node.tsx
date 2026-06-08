'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';
import type { WhatsAppSendTemplateNodeConfig } from '@chatbot/agent-studio';

export interface WhatsAppSendTemplateNodeData extends Record<string, unknown> {
  label: string;
  config: WhatsAppSendTemplateNodeConfig;
  selected?: boolean;
}

export const WhatsAppSendTemplateNode = memo(function WhatsAppSendTemplateNode({ data, selected }: NodeProps) {
  const nodeData = data as WhatsAppSendTemplateNodeData;
  const config = nodeData.config as WhatsAppSendTemplateNodeConfig;

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
        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">WA Template</Badge>
      </div>

      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-muted-foreground truncate" title={config.templateName}>
          {config.templateName || 'No template set'}
        </p>
        <p className="text-[11px] text-muted-foreground">
          lang: {config.languageCode ?? 'en'}
        </p>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
});

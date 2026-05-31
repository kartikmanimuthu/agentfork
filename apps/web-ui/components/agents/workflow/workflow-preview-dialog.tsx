'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { WorkflowDefinition } from '@chatbot/shared/client';

interface Props { agentId: string; getDefinition: () => WorkflowDefinition }

export function WorkflowPreviewDialog({ getDefinition }: Props) {
  const [open, setOpen] = useState(false);
  const [def, setDef] = useState<WorkflowDefinition | null>(null);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setDef(getDefinition()); }}>
      <DialogTrigger><Button variant="outline" size="sm">Preview</Button></DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Workflow preview</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <iframe
            title="widget-preview"
            className="w-full h-[480px] border rounded"
            srcDoc={`<!DOCTYPE html><html><head><script type="module" src="/sdk-assets/smc-chat-widget.esm.js"><\/script><style>body{margin:0;background:#f9fafb}</style></head><body><smc-chat-widget sdk-id="preview" mock-scenario="menu" mock-config='${JSON.stringify({ apiKeyPrefix: 'preview', primaryColor: '#4f46e5', secondaryColor: '#06b6d4', position: 'right', theme: 'light', botName: 'Preview', welcomeMessage: 'Send a message to walk the menu.' })}'></smc-chat-widget></body></html>`}
          />
          <pre className="text-xs overflow-auto h-[480px] bg-muted/30 rounded p-3">{JSON.stringify(def, null, 2)}</pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}

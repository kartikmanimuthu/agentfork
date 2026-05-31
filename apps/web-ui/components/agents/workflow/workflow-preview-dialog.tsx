'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { WorkflowDefinition } from '@chatbot/shared/client';

interface Props { agentId: string; getDefinition: () => WorkflowDefinition }

type Scenario = 'thinking' | 'menu' | 'files' | 'image';
const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: 'thinking', label: 'Thinking' },
  { key: 'menu', label: 'Menu' },
  { key: 'files', label: 'Files' },
  { key: 'image', label: 'Image' },
];

const MOCK_CONFIG = JSON.stringify({
  apiKeyPrefix: 'preview',
  primaryColor: '#4f46e5',
  secondaryColor: '#06b6d4',
  position: 'right',
  theme: 'light',
  botName: 'Preview',
  welcomeMessage: 'Send a message to play the selected scenario.',
});

function buildSrcDoc(scenario: Scenario): string {
  return `<!DOCTYPE html><html><head><script type="module" src="/sdk-assets/smc-chat-widget.esm.js"><\/script><style>html,body{margin:0;height:100%;background:#f9fafb}</style></head><body><smc-chat-widget sdk-id="preview" mock-scenario="${scenario}" mock-config='${MOCK_CONFIG}'></smc-chat-widget></body></html>`;
}

export function WorkflowPreviewDialog({ getDefinition }: Props) {
  const [open, setOpen] = useState(false);
  const [def, setDef] = useState<WorkflowDefinition | null>(null);
  const [scenario, setScenario] = useState<Scenario>('thinking');
  // bump to force the iframe to remount when the scenario changes
  const [iframeKey, setIframeKey] = useState(0);

  const pick = (s: Scenario) => { setScenario(s); setIframeKey((k) => k + 1); };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setDef(getDefinition()); }}>
      <DialogTrigger><Button variant="outline" size="sm">Preview</Button></DialogTrigger>
      <DialogContent className="max-w-5xl w-[90vw]">
        <DialogHeader><DialogTitle>Workflow preview</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide mr-1">Scenario</span>
          {SCENARIOS.map((s) => (
            <Button
              key={s.key}
              variant={scenario === s.key ? 'default' : 'outline'}
              size="sm"
              onClick={() => pick(s.key)}
            >{s.label}</Button>
          ))}
          <span className="text-xs text-muted-foreground ml-2">Open the widget (bottom-right) and send any message to play it.</span>
        </div>
        <div className="grid grid-cols-[1fr_360px] gap-4">
          <iframe
            key={iframeKey}
            title="widget-preview"
            className="w-full h-[560px] border rounded bg-white"
            srcDoc={buildSrcDoc(scenario)}
          />
          <pre className="text-xs overflow-auto h-[560px] bg-muted/30 rounded p-3">{JSON.stringify(def, null, 2)}</pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}

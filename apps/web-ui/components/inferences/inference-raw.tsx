'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Copy, Check, WrapText } from 'lucide-react';

interface InferenceRawProps {
  execution: {
    id: string;
    input: unknown;
    output: unknown;
    error: string | null;
    tokenUsage: unknown;
    latencyMs: number | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    status: string;
    cacheHit: boolean;
    webhookUrl: string | null;
    webhookStatus: string | null;
  };
  agent: { id: string; name: string; type: string } | null;
  agentVersion: { id: string; version: number; status: string } | null;
}

type RawSubTab = 'request' | 'response' | 'full';

export function InferenceRaw({ execution, agent, agentVersion }: InferenceRawProps) {
  const [subTab, setSubTab] = useState<RawSubTab>('request');
  const [wordWrap, setWordWrap] = useState(true);
  const [copied, setCopied] = useState(false);

  const requestPayload = {
    executionId: execution.id,
    agent: agent ? { id: agent.id, name: agent.name, type: agent.type } : null,
    agentVersion: agentVersion ? { id: agentVersion.id, version: agentVersion.version } : null,
    input: execution.input,
    cacheHit: execution.cacheHit,
    startedAt: execution.startedAt,
  };

  const responsePayload = {
    status: execution.status,
    output: execution.output,
    error: execution.error,
    tokenUsage: execution.tokenUsage,
    latencyMs: execution.latencyMs,
    completedAt: execution.completedAt,
    webhookStatus: execution.webhookStatus,
  };

  const fullPayload = {
    execution: {
      id: execution.id,
      status: execution.status,
      input: execution.input,
      output: execution.output,
      error: execution.error,
      tokenUsage: execution.tokenUsage,
      cacheHit: execution.cacheHit,
      latencyMs: execution.latencyMs,
      webhookUrl: execution.webhookUrl,
      webhookStatus: execution.webhookStatus,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      createdAt: execution.createdAt,
    },
    agent,
    agentVersion,
  };

  const getContent = (): string => {
    switch (subTab) {
      case 'request':
        return JSON.stringify(requestPayload, null, 2);
      case 'response':
        return JSON.stringify(responsePayload, null, 2);
      case 'full':
        return JSON.stringify(fullPayload, null, 2);
    }
  };

  const content = getContent();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tabs */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b shrink-0">
        <div className="flex gap-1">
          {(
            [
              ['request', 'Request'],
              ['response', 'Response'],
              ['full', 'Full Payload'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSubTab(key)}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                subTab === key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => setWordWrap(!wordWrap)}
            title="Toggle word wrap"
          >
            <WrapText className={cn('h-3 w-3', wordWrap && 'text-primary')} />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleCopy} title="Copy">
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <pre
          className={cn(
            'p-3 text-[11px] font-mono text-foreground',
            wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
          )}
        >
          {content}
        </pre>
      </ScrollArea>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Copy, Check, WrapText } from 'lucide-react';
import type { RawData } from '@/lib/playground/types';

interface ConsoleRawProps {
  rawData: RawData | null;
}

type RawSubTab = 'request' | 'response' | 'sse';

export function ConsoleRaw({ rawData }: ConsoleRawProps) {
  const [subTab, setSubTab] = useState<RawSubTab>('request');
  const [wordWrap, setWordWrap] = useState(true);
  const [copied, setCopied] = useState(false);

  if (!rawData) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground">Select a message to view raw data.</p>
      </div>
    );
  }

  const getContent = (): string => {
    switch (subTab) {
      case 'request':
        return JSON.stringify(rawData.request, null, 2);
      case 'response':
        return JSON.stringify(rawData.response, null, 2);
      case 'sse':
        return rawData.sseStream.join('\n');
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
              ['sse', 'SSE Stream'],
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
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
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

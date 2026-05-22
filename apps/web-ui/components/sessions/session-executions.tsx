'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Execution {
  id: string;
  status: string;
  latencyMs: number | null;
  tokenUsage: unknown;
  cacheHit: boolean;
  webhookStatus: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface SessionExecutionsProps {
  executions: Execution[];
}

export function SessionExecutions({ executions }: SessionExecutionsProps) {
  const [open, setOpen] = useState(false);

  const formatLatency = (ms: number | null) => {
    if (ms === null) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  const tokenTotal = (u: unknown): string => {
    if (!u || typeof u !== 'object') return '—';
    const t = (u as { totalTokens?: number }).totalTokens;
    return typeof t === 'number' ? t.toLocaleString() : '—';
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

  if (executions.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors">
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        Executions ({executions.length})
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">ID</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Latency</th>
                <th className="px-3 py-2 text-left font-medium">Tokens</th>
                <th className="px-3 py-2 text-left font-medium">Cache</th>
                <th className="px-3 py-2 text-left font-medium">Webhook</th>
                <th className="px-3 py-2 text-left font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((ex) => (
                <tr key={ex.id} className="border-b last:border-b-0 hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-xs">{ex.id.slice(0, 12)}…</td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={ex.status === 'completed' ? 'default' : 'secondary'}
                      className="text-[10px] px-1.5"
                    >
                      {ex.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{formatLatency(ex.latencyMs)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{tokenTotal(ex.tokenUsage)}</td>
                  <td className="px-3 py-2 text-xs">{ex.cacheHit ? 'hit' : 'miss'}</td>
                  <td className="px-3 py-2 text-xs">{ex.webhookStatus ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(ex.completedAt ?? ex.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

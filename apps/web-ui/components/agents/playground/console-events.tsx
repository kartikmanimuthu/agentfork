'use client';

import { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowDown } from 'lucide-react';
import type { ConsoleEvent, EventSeverity } from '@/lib/playground/types';

interface ConsoleEventsProps {
  events: ConsoleEvent[];
  isAutoScrolling: boolean;
  onAutoScrollChange: (value: boolean) => void;
  severityFilter: Set<EventSeverity>;
  onSeverityFilterChange: (filter: Set<EventSeverity>) => void;
  eventTypes: string[];
  eventTypeFilter: Set<string>;
  onEventTypeFilterChange: (filter: Set<string>) => void;
}

const SEVERITY_COLORS: Record<EventSeverity, string> = {
  info: 'text-green-500',
  warn: 'text-yellow-500',
  error: 'text-red-500',
};

function formatRelativeMs(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  return `+${(ms / 1000).toFixed(1)}s`;
}

function getEventDetail(event: ConsoleEvent): string {
  const d = event.data;
  switch (event.type) {
    case 'execution_start':
      return `model: ${d.model}, temp: ${d.temperature}`;
    case 'tool_call':
      return `${d.toolName}(${JSON.stringify(d.args).slice(0, 60)})`;
    case 'tool_result':
      return `${d.toolName} → ${JSON.stringify(d.result).slice(0, 60)}`;
    case 'thinking_end':
      return `${d.tokens} tokens, ${d.durationMs}ms`;
    case 'execution_end': {
      const usage = d.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      return `total: ${((d.durationMs as number) / 1000).toFixed(1)}s, tokens: ${usage?.inputTokens ?? 0}+${usage?.outputTokens ?? 0}`;
    }
    case 'error':
      return String(d.message ?? '');
    case 'text_delta':
      return '';
    default:
      return JSON.stringify(d).slice(0, 80);
  }
}

export function ConsoleEvents({
  events,
  isAutoScrolling,
  onAutoScrollChange,
  severityFilter,
  onSeverityFilterChange,
  eventTypes,
  eventTypeFilter,
  onEventTypeFilterChange,
}: ConsoleEventsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAutoScrolling && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events.length, isAutoScrolling]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (!atBottom && isAutoScrolling) onAutoScrollChange(false);
  };

  // Filter out text_delta noise by default (too many events)
  const displayEvents = events.filter((e) => e.type !== 'text_delta');

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b shrink-0">
        <div className="flex gap-1">
          {(['info', 'warn', 'error'] as EventSeverity[]).map((sev) => (
            <button
              key={sev}
              onClick={() => {
                const next = new Set(severityFilter);
                if (next.has(sev)) next.delete(sev);
                else next.add(sev);
                onSeverityFilterChange(next);
              }}
              className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-mono uppercase transition-opacity',
                SEVERITY_COLORS[sev],
                !severityFilter.has(sev) && 'opacity-30'
              )}
            >
              {sev}
            </button>
          ))}
        </div>
        {eventTypes.length > 0 && (
          <Select
            value={eventTypeFilter.size === 0 ? 'all' : Array.from(eventTypeFilter)[0]}
            onValueChange={(val) => {
              if (val === 'all') onEventTypeFilterChange(new Set());
              else onEventTypeFilterChange(new Set([val]));
            }}
          >
            <SelectTrigger className="h-6 text-[10px] w-[120px]">
              <SelectValue placeholder="All events" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {eventTypes
                .filter((t) => t !== 'text_delta')
                .map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Event list */}
      <div
        className="flex-1 overflow-auto font-mono text-[11px] relative"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {displayEvents.length === 0 && (
          <p className="text-xs text-muted-foreground p-3">Run the agent to see events.</p>
        )}
        <table className="w-full">
          <tbody>
            {displayEvents.map((event) => (
              <tr key={event.id} className="border-b border-border/30 hover:bg-muted/30">
                <td className="px-2 py-1 text-muted-foreground whitespace-nowrap w-[70px]">
                  {formatRelativeMs(event.relativeMs)}
                </td>
                <td className={cn('px-1 py-1 w-[40px]', SEVERITY_COLORS[event.severity])}>
                  {event.severity.toUpperCase()}
                </td>
                <td className="px-2 py-1 whitespace-nowrap font-medium w-[120px]">{event.type}</td>
                <td className="px-2 py-1 text-muted-foreground truncate max-w-[200px]">
                  {getEventDetail(event)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div ref={bottomRef} />

        {/* Resume auto-scroll */}
        {!isAutoScrolling && (
          <div className="sticky bottom-2 flex justify-end pr-2">
            <Button
              size="icon"
              variant="secondary"
              className="h-6 w-6"
              onClick={() => onAutoScrollChange(true)}
            >
              <ArrowDown className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Terminal, FileCode, GitBranch, BarChart3, X } from 'lucide-react';
import { ConsoleEvents } from './console-events';
import { ConsoleRaw } from './console-raw';
import { ConsoleTrace } from './console-trace';
import { ConsoleMetrics } from './console-metrics';
import type {
  ConsoleTab,
  ConsoleEvent,
  EventSeverity,
  MessageMetrics,
  SessionMetrics,
  RawData,
} from '@/lib/playground/types';

interface PlaygroundConsoleProps {
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
  events: ConsoleEvent[];
  isAutoScrolling: boolean;
  onAutoScrollChange: (value: boolean) => void;
  severityFilter: Set<EventSeverity>;
  onSeverityFilterChange: (filter: Set<EventSeverity>) => void;
  eventTypes: string[];
  eventTypeFilter: Set<string>;
  onEventTypeFilterChange: (filter: Set<string>) => void;
  rawData: RawData | null;
  selectedMetrics: MessageMetrics | null;
  sessionMetrics: SessionMetrics;
  selectedMessageId: string | null;
  onClearSelection: () => void;
}

const TABS: {
  id: ConsoleTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'events', label: 'Events', icon: Terminal },
  { id: 'raw', label: 'Raw', icon: FileCode },
  { id: 'trace', label: 'Trace', icon: GitBranch },
  { id: 'metrics', label: 'Metrics', icon: BarChart3 },
];

export function PlaygroundConsole({
  activeTab,
  onTabChange,
  events,
  isAutoScrolling,
  onAutoScrollChange,
  severityFilter,
  onSeverityFilterChange,
  eventTypes,
  eventTypeFilter,
  onEventTypeFilterChange,
  rawData,
  selectedMetrics,
  sessionMetrics,
  selectedMessageId,
  onClearSelection,
}: PlaygroundConsoleProps) {
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Tab bar */}
      <div className="flex items-center border-b px-2 py-1 shrink-0">
        <div className="flex gap-0.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                activeTab === id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
        {selectedMessageId && (
          <div className="ml-auto flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">Filtered to message</span>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClearSelection}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'events' && (
          <ConsoleEvents
            events={events}
            isAutoScrolling={isAutoScrolling}
            onAutoScrollChange={onAutoScrollChange}
            severityFilter={severityFilter}
            onSeverityFilterChange={onSeverityFilterChange}
            eventTypes={eventTypes}
            eventTypeFilter={eventTypeFilter}
            onEventTypeFilterChange={onEventTypeFilterChange}
          />
        )}
        {activeTab === 'raw' && <ConsoleRaw rawData={rawData} />}
        {activeTab === 'trace' && <ConsoleTrace events={events} />}
        {activeTab === 'metrics' && (
          <ConsoleMetrics selectedMetrics={selectedMetrics} sessionMetrics={sessionMetrics} />
        )}
      </div>
    </div>
  );
}

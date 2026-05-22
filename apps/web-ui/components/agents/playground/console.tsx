'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Terminal, FileCode, GitBranch, BarChart3, Settings, X } from 'lucide-react';
import { ConsoleEvents } from './console-events';
import { ConsoleRaw } from './console-raw';
import { ConsoleTrace } from './console-trace';
import { ConsoleMetrics } from './console-metrics';
import { ConsoleConfig } from './console-config';
import type {
  ConsoleTab,
  ConsoleEvent,
  EventSeverity,
  MessageMetrics,
  SessionMetrics,
  RawData,
} from '@/lib/playground/types';

interface ConfigProps {
  agentId: string;
  versionValue: string;
  onVersionChange: (value: string) => void;
  model: string;
  onModelChange: (value: string) => void;
  systemPrompt: string;
  onSystemPromptChange: (value: string) => void;
  temperature: number;
  onTemperatureChange: (value: number) => void;
  maxTokens: number | undefined;
  onMaxTokensChange: (value: number | undefined) => void;
  onApplyOverrides: () => void;
}

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
  config: ConfigProps;
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
  { id: 'config', label: 'Config', icon: Settings },
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
  config,
}: PlaygroundConsoleProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center justify-between border-b bg-background/80 backdrop-blur-sm px-1 shrink-0">
        <div className="flex">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium transition-colors border-b-2 -mb-px',
                activeTab === id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        {selectedMessageId && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] gap-1 text-muted-foreground"
            onClick={onClearSelection}
          >
            Filtered
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden bg-muted/30">
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
        {activeTab === 'config' && <ConsoleConfig {...config} />}
      </div>
    </div>
  );
}

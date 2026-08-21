'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ChevronRight, Inbox } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRuns, type RunStatus, type RunSummary } from '@/hooks/use-runs';
import { CHANNEL_VISUALS } from '@/components/connectors/channel-visuals';
import { RunStatusBadge } from './run-status-badge';

const SOURCE_LABELS: Record<string, string> = { slack: 'Slack', telegram: 'Telegram', discord: 'Discord' };

const FILTERS: Array<{ label: string; status?: RunStatus }> = [
  { label: 'All' },
  { label: 'Needs you', status: 'awaiting_approval' },
  { label: 'Running', status: 'in_progress' },
  { label: 'Completed', status: 'completed' },
  { label: 'Failed', status: 'failed' },
];

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function SourceChip({ source }: { source: RunSummary['source'] }) {
  const visual = source === 'dashboard' ? null : CHANNEL_VISUALS[source];
  if (!visual) {
    return (
      <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
        Dashboard
      </Badge>
    );
  }
  const Icon = visual.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${visual.iconColor}`}>
      <Icon className="h-3.5 w-3.5" />
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

export function RunsClient() {
  const router = useRouter();
  const [status, setStatus] = useState<RunStatus | undefined>(undefined);
  const { data, isLoading, error } = useRuns({ status });

  const runs = data?.runs ?? [];
  const counts = data?.counts ?? {};
  const needsYou = (counts.awaiting_approval ?? 0) + (counts.awaiting_input ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Activity className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Runs</h1>
          <p className="text-sm text-muted-foreground">
            Tasks Claw picked up from a connected channel, and anything waiting on you.
          </p>
        </div>
        {needsYou > 0 ? (
          <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-500">
            {needsYou} waiting on you
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <Button
            key={filter.label}
            size="sm"
            variant={status === filter.status ? 'default' : 'outline'}
            onClick={() => setStatus(filter.status)}
          >
            {filter.label}
            {filter.status && counts[filter.status] ? (
              <span className="ml-1.5 text-xs opacity-70">{counts[filter.status]}</span>
            ) : null}
          </Button>
        ))}
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-sm text-destructive">
            {error instanceof Error ? error.message : 'Failed to load runs.'}
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium">No runs yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Connect Slack, Telegram, or Discord, then send Claw a task from there — it will show up here.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => router.push('/connectors')}>
              Set up a connector
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <Card
              key={run.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/runs/${run.runId}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') router.push(`/runs/${run.runId}`);
              }}
              className="cursor-pointer transition-colors hover:border-primary/50"
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate text-sm font-medium">
                    {run.taskDescription || 'Untitled task'}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <SourceChip source={run.source} />
                    <span>{relativeTime(run.createdAt)}</span>
                    {run.result?.toolsUsed?.length ? (
                      <span>{run.result.toolsUsed.length} tool(s)</span>
                    ) : null}
                  </div>
                </div>
                <RunStatusBadge status={run.status} />
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronRight, Inbox } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RunStatusBadge } from '@/components/runs/run-status-badge';
import { useScheduledTask, useTaskRuns } from '@/hooks/use-scheduled-tasks';

function formatTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function TaskDetailClient({ taskId }: { taskId: string }) {
  const router = useRouter();
  const { data: task, isLoading, error } = useScheduledTask(taskId);
  const { data: runs, isLoading: runsLoading } = useTaskRuns(taskId);

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  if (error || !task) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-6 text-sm text-destructive">
          {error instanceof Error ? error.message : 'That scheduled task no longer exists.'}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/scheduled-tasks')}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">{task.name}</h1>
          <p className="text-sm text-muted-foreground">
            {task.runCount} run{task.runCount === 1 ? '' : 's'} so far
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Schedule</CardTitle>
            <CardDescription>When and how this task runs.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Field label="Cadence">
              <span className="font-mono text-xs">
                {task.scheduleType === 'interval'
                  ? `Every ${task.intervalMinutes} min`
                  : task.scheduleType === 'once'
                    ? `Once · ${formatTime(task.runAt)}`
                    : task.cronExpression}
              </span>
            </Field>
            <Field label="Timezone">{task.timezone}</Field>
            <Field label="Next run">{formatTime(task.nextRunAt)}</Field>
            <Field label="Last run">{formatTime(task.lastRunAt)}</Field>
            <Field label="Context">
              {task.sessionMode === 'isolated' ? 'Isolated' : 'Main thread'}
            </Field>
            <Field label="Status">
              {task.status === 'active'
                ? <Badge variant="secondary">Active</Badge>
                : <Badge variant="outline">{task.status}</Badge>}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Permissions &amp; delivery</CardTitle>
            <CardDescription>What it may do unattended, and where results go.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Approval">
              {task.approvalMode === 'ask' && 'Asks before anything that changes something'}
              {task.approvalMode === 'all' && 'Runs everything without asking'}
              {task.approvalMode === 'allowlist' && `Allows ${task.allowedTools.length} tool${task.allowedTools.length === 1 ? '' : 's'} without asking`}
            </Field>
            {task.approvalMode === 'allowlist' && task.allowedTools.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {task.allowedTools.map((tool) => (
                  <Badge key={tool} variant="outline" className="font-mono text-[11px]">{tool}</Badge>
                ))}
              </div>
            )}
            <Field label="Delivery">
              {task.delivery?.type && task.delivery.type !== 'none'
                ? `${task.delivery.type}${task.delivery.target ? ` → ${task.delivery.target}` : ''}`
                : 'Recorded only, not sent anywhere'}
            </Field>
            {task.failureStreak > 0 && (
              <p className="text-xs text-destructive">
                {task.failureStreak} consecutive failure{task.failureStreak === 1 ? '' : 's'}.
                Three in a row pauses the task automatically.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prompt</CardTitle>
          <CardDescription>What Claw is told on every run.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-4 font-mono text-xs">
            {task.prompt}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run history</CardTitle>
          <CardDescription>Every run this task has produced.</CardDescription>
        </CardHeader>
        <CardContent>
          {runsLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !runs?.length ? (
            <div className="py-10 text-center">
              <Inbox className="mx-auto h-7 w-7 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                No runs yet. Use “Run now” to try it.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <Link
                  key={run.runId}
                  href={`/runs/${run.runId}`}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50"
                >
                  <div className="min-w-0">
                    <p className="text-sm">{formatTime(run.createdAt)}</p>
                    {run.error && (
                      <p className="mt-0.5 truncate text-xs text-destructive">{run.error}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <RunStatusBadge status={run.status} />
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  CalendarClock, CheckCircle2, Loader2, Pause, Pencil, Play, Plus, RefreshCw, Trash2, XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeaderTitle } from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type ScheduledTaskDTO, useDeleteScheduledTask, useScheduledTasks,
  useTriggerScheduledTask, useUpdateScheduledTask,
} from '@/hooks/use-scheduled-tasks';
import { ScheduledTaskDialog } from './scheduled-task-dialog';

function formatTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatSchedule(task: ScheduledTaskDTO): string {
  if (task.scheduleType === 'interval') return `Every ${task.intervalMinutes} min`;
  if (task.scheduleType === 'once') return `Once · ${formatTime(task.runAt)}`;
  return task.cronExpression;
}

function StatusBadge({ status }: { status: ScheduledTaskDTO['status'] }) {
  if (status === 'active') return <Badge variant="secondary">Active</Badge>;
  if (status === 'paused') return <Badge variant="outline">Paused</Badge>;
  if (status === 'completed') return <Badge variant="outline">Done</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function LastRunGlyph({ status }: { status: string | null }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-muted-foreground" />;
  if (status === 'failed' || status === 'cancelled') return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === 'in_progress' || status === 'queued') {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }
  return null;
}

export function ScheduledTasksClient() {
  const router = useRouter();
  const { data, isLoading, error, refetch, isFetching } = useScheduledTasks();
  const update = useUpdateScheduledTask();
  const remove = useDeleteScheduledTask();
  const trigger = useTriggerScheduledTask();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledTaskDTO | undefined>();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!dialogOpen) setEditing(undefined);
  }, [dialogOpen]);

  const stats = useMemo(() => {
    const tasks = data ?? [];
    return {
      active: tasks.filter((t) => t.status === 'active').length,
      paused: tasks.filter((t) => t.status === 'paused').length,
      totalRuns: tasks.reduce((sum, t) => sum + t.runCount, 0),
    };
  }, [data]);

  const withBusy = async (taskId: string, fn: () => Promise<unknown>, failure: string) => {
    setBusyId(taskId);
    try {
      await fn();
    } catch (err) {
      toast.error(failure, { description: err instanceof Error ? err.message : 'Try again' });
    } finally {
      setBusyId(null);
    }
  };

  const onTrigger = (task: ScheduledTaskDTO) =>
    withBusy(task.taskId, async () => {
      await trigger.mutateAsync(task.taskId);
      toast.success('Run started', { description: `${task.name} is running now` });
    }, 'Could not start the run');

  const onTogglePause = (task: ScheduledTaskDTO) =>
    withBusy(task.taskId, async () => {
      const next = task.status === 'active' ? 'paused' : 'active';
      await update.mutateAsync({ taskId: task.taskId, input: { status: next } });
      toast.success(next === 'paused' ? 'Task paused' : 'Task resumed', { description: task.name });
    }, 'Could not change the task');

  const onDelete = (task: ScheduledTaskDTO) =>
    withBusy(task.taskId, async () => {
      await remove.mutateAsync(task.taskId);
      toast.success('Task deleted', { description: task.name });
    }, 'Delete failed');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeaderTitle icon={CalendarClock} title="Scheduled Tasks" description="Work Claw does on its own, on a schedule." />
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button onClick={() => setDialogOpen(true)} data-testid="new-scheduled-task">
            <Plus className="w-4 h-4 mr-1" /> New scheduled task
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Active', value: stats.active },
          { label: 'Paused', value: stats.paused },
          { label: 'Total runs', value: stats.totalRuns },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="px-4 pb-3 pt-4">
              <div className="text-2xl font-semibold">{stat.value}</div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tasks</CardTitle>
          <CardDescription>Click a task to view its run history and details.</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="py-8 text-center text-sm text-destructive">
              {error instanceof Error ? error.message : 'Failed to load scheduled tasks.'}
            </p>
          ) : isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : !data?.length ? (
            <div className="py-12 text-center">
              <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">No scheduled tasks yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create one here, or ask Claw in chat and use “Schedule this”.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.map((task) => {
                const busy = busyId === task.taskId;
                return (
                  <div
                    key={task.taskId}
                    role="button"
                    tabIndex={0}
                    data-testid="task-row"
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50"
                    onClick={() => router.push(`/scheduled-tasks/${task.taskId}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') router.push(`/scheduled-tasks/${task.taskId}`);
                    }}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                        <CalendarClock className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{task.name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{formatSchedule(task)}</span>
                          <span>·</span>
                          <span>{task.timezone}</span>
                          <span>·</span>
                          <span>Next: {formatTime(task.nextRunAt)}</span>
                          {task.lastRunAt && (
                            <>
                              <span>·</span>
                              <span>Last: {formatTime(task.lastRunAt)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Row actions must not navigate. */}
                    <div
                      className="flex shrink-0 items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <LastRunGlyph status={task.lastRunStatus} />
                      <StatusBadge status={task.status} />
                      <Button
                        variant="ghost" size="sm" className="h-7 px-2" disabled={busy}
                        onClick={() => onTrigger(task)} title="Run now"
                        data-testid="task-run-now"
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="ghost" size="sm" className="h-7 px-2" disabled={busy}
                        onClick={() => onTogglePause(task)}
                        title={task.status === 'active' ? 'Pause' : 'Resume'}
                        data-testid="task-toggle-pause"
                      >
                        {task.status === 'active'
                          ? <Pause className="h-3.5 w-3.5" />
                          : <Play className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="ghost" size="sm" className="h-7 px-2" disabled={busy}
                        onClick={() => { setEditing(task); setDialogOpen(true); }} title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="sm" className="h-7 px-2 text-destructive"
                        disabled={busy} onClick={() => onDelete(task)} title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ScheduledTaskDialog open={dialogOpen} onOpenChange={setDialogOpen} task={editing} />
    </div>
  );
}

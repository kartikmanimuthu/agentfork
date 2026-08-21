import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RunStatus } from '@/hooks/use-runs';
import { BASE_PATH } from '@/lib/base-path';

export type ScheduleType = 'cron' | 'interval' | 'once';
export type TaskStatus = 'active' | 'paused' | 'completed' | 'deleted';
export type ApprovalMode = 'ask' | 'allowlist' | 'all';
export type SessionMode = 'isolated' | 'main';
export type DeliveryChannel = 'slack' | 'telegram' | 'discord' | 'jira' | 'email' | 'none';

export interface ScheduledTaskDTO {
  taskId: string;
  name: string;
  prompt: string;
  scheduleType: ScheduleType;
  cronExpression: string;
  intervalMinutes: number | null;
  runAt: string | null;
  timezone: string;
  status: TaskStatus;
  approvalMode: ApprovalMode;
  allowedTools: string[];
  sessionMode: SessionMode;
  delivery: { type: DeliveryChannel; target?: string };
  lastRunId: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string | null;
  runCount: number;
  failureStreak: number;
  createdAt: string;
}

export interface TaskRunDTO {
  runId: string;
  /** Same union the Runs page uses, so RunStatusBadge can render it directly. */
  status: RunStatus;
  createdAt: string;
  completedAt: string | null;
  taskDescription: string;
  error: string | null;
}

export interface GrantableToolGroup {
  source: string;
  displayName: string;
  tools: Array<{ name: string; description: string; mutative: boolean }>;
}

export interface TaskDraft {
  name: string;
  prompt: string;
  suggestedCron: string;
  cadenceLabel: string;
  suggestedTools: string[];
}

export type SaveTaskInput = Partial<
  Pick<
    ScheduledTaskDTO,
    'name' | 'prompt' | 'scheduleType' | 'cronExpression' | 'intervalMinutes'
    | 'timezone' | 'approvalMode' | 'allowedTools' | 'sessionMode' | 'delivery' | 'status'
  >
> & { runAt?: string | null };

const keys = {
  all: ['scheduled-tasks'] as const,
  list: () => [...keys.all, 'list'] as const,
  detail: (taskId: string) => [...keys.all, 'detail', taskId] as const,
  runs: (taskId: string) => [...keys.all, 'runs', taskId] as const,
  grantable: () => [...keys.all, 'grantable-tools'] as const,
};

async function unwrap<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return body.data as T;
}

export function useScheduledTasks() {
  return useQuery({
    queryKey: keys.list(),
    queryFn: () => fetch(`${BASE_PATH}/api/scheduled-tasks`).then((r) => unwrap<ScheduledTaskDTO[]>(r)),
  });
}

export function useScheduledTask(taskId: string | null) {
  return useQuery({
    queryKey: keys.detail(taskId ?? ''),
    queryFn: () => fetch(`${BASE_PATH}/api/scheduled-tasks/${taskId}`).then((r) => unwrap<ScheduledTaskDTO>(r)),
    enabled: !!taskId,
  });
}

export function useTaskRuns(taskId: string | null) {
  return useQuery({
    queryKey: keys.runs(taskId ?? ''),
    queryFn: () => fetch(`${BASE_PATH}/api/scheduled-tasks/${taskId}/runs`).then((r) => unwrap<TaskRunDTO[]>(r)),
    enabled: !!taskId,
  });
}

export function useGrantableTools(enabled = true) {
  return useQuery({
    queryKey: keys.grantable(),
    queryFn: () =>
      fetch(`${BASE_PATH}/api/scheduled-tasks/grantable-tools`).then((r) => unwrap<GrantableToolGroup[]>(r)),
    enabled,
  });
}

export function useCreateScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveTaskInput) =>
      fetch(`${BASE_PATH}/api/scheduled-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }).then((r) => unwrap<ScheduledTaskDTO>(r)),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useUpdateScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: SaveTaskInput }) =>
      fetch(`${BASE_PATH}/api/scheduled-tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }).then((r) => unwrap<ScheduledTaskDTO>(r)),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useDeleteScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      fetch(`${BASE_PATH}/api/scheduled-tasks/${taskId}`, { method: 'DELETE' }).then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok || !body.success) throw new Error(body.error ?? 'Delete failed');
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useTriggerScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      fetch(`${BASE_PATH}/api/scheduled-tasks/${taskId}/trigger`, { method: 'POST' })
        .then((r) => unwrap<{ taskId: string; scheduledAt: string }>(r)),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useDistillTask() {
  return useMutation({
    mutationFn: (transcript: string) =>
      fetch(`${BASE_PATH}/api/scheduled-tasks/distill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      }).then((r) => unwrap<TaskDraft>(r)),
  });
}

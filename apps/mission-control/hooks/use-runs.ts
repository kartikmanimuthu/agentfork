import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BASE_PATH } from '@/lib/base-path';

export type RunStatus =
  | 'queued'
  | 'in_progress'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RunSource = 'slack' | 'telegram' | 'discord' | 'dashboard';

export interface ApprovalRequest {
  kind: 'plan' | 'tool';
  planSteps?: string[];
  pendingTools?: string[];
}

export interface RunSummary {
  id: string;
  runId: string;
  source: RunSource;
  status: RunStatus;
  taskDescription: string;
  result: { answer: string; iterations?: number; toolsUsed?: string[] } | null;
  clarification: { question: string } | null;
  approvalRequest: ApprovalRequest | null;
  error: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface RunEvent {
  id: string;
  eventType: string;
  node: string | null;
  content: string | null;
  toolName: string | null;
  toolOutput: string | null;
  metadata: unknown;
  createdAt: string;
}

export type RunAction = 'approve' | 'reject' | 'cancel' | 'respond';

/** Statuses that mean the run is still moving, so the view should keep polling. */
export const LIVE_STATUSES: RunStatus[] = ['queued', 'in_progress'];

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(data?.error ?? fallback);
  }
  return data as T;
}

async function fetchRuns(filter: { status?: RunStatus; source?: RunSource }): Promise<{
  runs: RunSummary[];
  counts: Record<string, number>;
}> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.source) params.set('source', filter.source);
  const res = await fetch(`${BASE_PATH}/api/runs?${params.toString()}`);
  return unwrap(res, 'Failed to load runs');
}

async function fetchRun(runId: string): Promise<{ run: RunSummary; events: RunEvent[] }> {
  const res = await fetch(`${BASE_PATH}/api/runs/${runId}`);
  const data = await unwrap<{ data: { run: RunSummary; events: RunEvent[] } }>(res, 'Failed to load run');
  return data.data;
}

async function actOnRun(runId: string, action: RunAction, content?: string): Promise<void> {
  const res = await fetch(`${BASE_PATH}/api/runs/${runId}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action === 'respond' ? { action, content } : { action }),
  });
  await unwrap(res, `Failed to ${action} run`);
}

export const runKeys = {
  all: ['runs'] as const,
  lists: () => [...runKeys.all, 'list'] as const,
  list: (filter: { status?: RunStatus; source?: RunSource }) => [...runKeys.lists(), filter] as const,
  details: () => [...runKeys.all, 'detail'] as const,
  detail: (runId: string) => [...runKeys.details(), runId] as const,
};

export function useRuns(filter: { status?: RunStatus; source?: RunSource } = {}) {
  return useQuery({
    queryKey: runKeys.list(filter),
    queryFn: () => fetchRuns(filter),
    // Runs advance in a worker with no push channel to the browser, so the list
    // polls. Slow enough not to be chatty, fast enough to feel live.
    refetchInterval: 10_000,
  });
}

export function useRun(runId: string) {
  return useQuery({
    queryKey: runKeys.detail(runId),
    queryFn: () => fetchRun(runId),
    enabled: Boolean(runId),
    // Poll while the run is still executing; stop once it settles or is waiting
    // on a human, since nothing will change without an action.
    refetchInterval: (query) =>
      query.state.data && LIVE_STATUSES.includes(query.state.data.run.status) ? 3_000 : false,
  });
}

export function useRunAction(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, content }: { action: RunAction; content?: string }) =>
      actOnRun(runId, action, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runKeys.detail(runId) });
      queryClient.invalidateQueries({ queryKey: runKeys.lists() });
    },
  });
}

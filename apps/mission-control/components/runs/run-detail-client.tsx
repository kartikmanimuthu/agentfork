'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Ban, Check, MessageCircleQuestion, Send, ShieldQuestion, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownContent } from '@/components/ui/markdown-content';
import { useRun, useRunAction, type RunAction, type RunSummary } from '@/hooks/use-runs';
import { RunStatusBadge } from './run-status-badge';
import { RunTimeline } from './run-timeline';

const SOURCE_LABELS: Record<string, string> = { slack: 'Slack', telegram: 'Telegram', discord: 'Discord' };

function SourceLabel({ run }: { run: RunSummary }) {
  const label = SOURCE_LABELS[run.source] ?? 'Dashboard';
  return (
    <span className="text-xs text-muted-foreground">
      From {label}
      {run.userId ? ` · ${run.userId}` : ''} · {new Date(run.createdAt).toLocaleString()}
    </span>
  );
}

/** Plan or tool approval, answered from here as well as from the channel. */
function ApprovalCard({ run, onAct, pending }: {
  run: RunSummary;
  onAct: (action: RunAction) => void;
  pending: boolean;
}) {
  const request = run.approvalRequest;
  if (!request) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldQuestion className="h-4 w-4 text-amber-600 dark:text-amber-500" />
          {request.kind === 'tool' ? 'Claw wants to run a tool' : 'Claw wants approval for its plan'}
        </CardTitle>
        <CardDescription>
          Approving here also notifies the channel this run came from.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {request.kind === 'tool' ? (
          <ul className="space-y-1 text-sm">
            {(request.pendingTools ?? []).map((tool) => (
              <li key={tool} className="font-mono text-xs">
                {tool}
              </li>
            ))}
          </ul>
        ) : (
          <ol className="space-y-1 text-sm">
            {(request.planSteps ?? []).map((step, i) => (
              <li key={`${i}-${step}`}>
                {i + 1}. {step}
              </li>
            ))}
          </ol>
        )}
        <div className="flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => onAct('approve')}>
            <Check className="mr-1.5 h-4 w-4" />
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onAct('reject')}>
            <X className="mr-1.5 h-4 w-4" />
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ClarificationCard({ run, onRespond, pending }: {
  run: RunSummary;
  onRespond: (content: string) => void;
  pending: boolean;
}) {
  const [content, setContent] = useState('');
  if (!run.clarification) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircleQuestion className="h-4 w-4 text-amber-600 dark:text-amber-500" />
          Claw needs more information
        </CardTitle>
        <CardDescription>{run.clarification.question}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Type your answer…"
          rows={3}
        />
        <Button
          size="sm"
          disabled={pending || !content.trim()}
          onClick={() => {
            onRespond(content.trim());
            setContent('');
          }}
        >
          <Send className="mr-1.5 h-4 w-4" />
          Send reply
        </Button>
      </CardContent>
    </Card>
  );
}

export function RunDetailClient({ runId }: { runId: string }) {
  const router = useRouter();
  const { data, isLoading, error } = useRun(runId);
  const action = useRunAction(runId);

  const act = (next: RunAction, content?: string) => {
    action.mutate(
      { action: next, content },
      {
        onSuccess: () =>
          toast.success(
            next === 'approve'
              ? 'Approved — Claw is continuing.'
              : next === 'reject'
                ? 'Rejected.'
                : next === 'cancel'
                  ? 'Run cancelled.'
                  : 'Reply sent.',
          ),
        onError: (err) => toast.error(err instanceof Error ? err.message : 'Action failed'),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="space-y-3 p-6">
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : 'Run not found.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => router.push('/runs')}>
            Back to runs
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { run, events } = data;
  const cancellable = ['queued', 'in_progress', 'awaiting_input', 'awaiting_approval'].includes(run.status);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/runs')} aria-label="Back to runs">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="break-words text-xl font-semibold">{run.taskDescription || 'Untitled task'}</h1>
          <SourceLabel run={run} />
        </div>
        <div className="flex items-center gap-2">
          <RunStatusBadge status={run.status} />
          {cancellable ? (
            <Button
              variant="outline"
              size="sm"
              disabled={action.isPending}
              onClick={() => act('cancel')}
            >
              <Ban className="mr-1.5 h-4 w-4" />
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {run.status === 'awaiting_approval' ? (
        <ApprovalCard run={run} onAct={act} pending={action.isPending} />
      ) : null}

      {run.status === 'awaiting_input' ? (
        <ClarificationCard
          run={run}
          onRespond={(content) => act('respond', content)}
          pending={action.isPending}
        />
      ) : null}

      {run.error ? (
        <Card className="border-destructive/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {run.status === 'cancelled' ? 'Why it stopped' : 'Error'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{run.error}</p>
          </CardContent>
        </Card>
      ) : null}

      {run.result?.answer ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Result</CardTitle>
            {run.result.toolsUsed?.length ? (
              <CardDescription>Used {run.result.toolsUsed.join(', ')}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            <MarkdownContent content={run.result.answer} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Timeline</CardTitle>
          <CardDescription>Every step Claw took, newest last.</CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <RunTimeline events={events} />
        </CardContent>
      </Card>
    </div>
  );
}

import {
  AlertTriangle,
  Ban,
  Brain,
  CheckCircle2,
  CircleDot,
  MessageCircleQuestion,
  Play,
  ShieldQuestion,
  Wrench,
} from 'lucide-react';
import type { RunEvent } from '@/hooks/use-runs';

const EVENT_META: Record<string, { icon: typeof CircleDot; className: string; label: string }> = {
  run_started: { icon: Play, className: 'text-blue-500', label: 'Task received' },
  node_complete: { icon: Brain, className: 'text-muted-foreground', label: 'Step' },
  tool_call: { icon: Wrench, className: 'text-violet-500', label: 'Called tool' },
  tool_result: { icon: CheckCircle2, className: 'text-green-600', label: 'Tool result' },
  clarification: { icon: MessageCircleQuestion, className: 'text-amber-500', label: 'Asked a question' },
  approval_request: { icon: ShieldQuestion, className: 'text-amber-500', label: 'Requested approval' },
  approval_decision: { icon: CheckCircle2, className: 'text-green-600', label: 'Decision' },
  status: { icon: Ban, className: 'text-muted-foreground', label: 'Status' },
  error: { icon: AlertTriangle, className: 'text-destructive', label: 'Error' },
};

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function headline(event: RunEvent): string {
  const meta = EVENT_META[event.eventType];
  if (event.eventType === 'tool_call' || event.eventType === 'tool_result') {
    return `${meta.label}: ${event.toolName ?? 'unknown'}`;
  }
  if (event.eventType === 'node_complete' && event.node) {
    return `${event.node.replace(/_/g, ' ')}`;
  }
  return meta?.label ?? event.eventType;
}

export function RunTimeline({ events }: { events: RunEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No steps recorded yet.
      </p>
    );
  }

  return (
    <ol className="space-y-0">
      {events.map((event, index) => {
        const meta = EVENT_META[event.eventType] ?? {
          icon: CircleDot,
          className: 'text-muted-foreground',
          label: event.eventType,
        };
        const Icon = meta.icon;
        const body = event.content || event.toolOutput;
        const isLast = index === events.length - 1;

        return (
          <li key={event.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`mt-1 ${meta.className}`}>
                <Icon className="h-4 w-4" />
              </span>
              {!isLast ? <span className="my-1 w-px flex-1 bg-border" /> : null}
            </div>
            <div className={`min-w-0 flex-1 ${isLast ? 'pb-1' : 'pb-4'}`}>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium capitalize">{headline(event)}</span>
                <span className="text-[11px] text-muted-foreground">{timeOf(event.createdAt)}</span>
              </div>
              {body ? (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {body.length > 600 ? `${body.slice(0, 600)}…` : body}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

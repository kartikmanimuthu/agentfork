import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  MessageCircleQuestion,
  ShieldQuestion,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { RunStatus } from '@/hooks/use-runs';

const STATUS_META: Record<
  RunStatus,
  { label: string; icon: typeof Clock; className: string; spin?: boolean }
> = {
  queued: {
    label: 'Queued',
    icon: Clock,
    className: 'text-muted-foreground border-border',
  },
  in_progress: {
    label: 'Running',
    icon: Loader2,
    className: 'text-blue-600 dark:text-blue-400 border-blue-500/40',
    spin: true,
  },
  awaiting_approval: {
    label: 'Needs approval',
    icon: ShieldQuestion,
    className: 'text-amber-600 dark:text-amber-500 border-amber-500/40',
  },
  awaiting_input: {
    label: 'Needs a reply',
    icon: MessageCircleQuestion,
    className: 'text-amber-600 dark:text-amber-500 border-amber-500/40',
  },
  completed: {
    label: 'Completed',
    icon: CheckCircle2,
    className: 'text-green-600 dark:text-green-500 border-green-500/40',
  },
  failed: {
    label: 'Failed',
    icon: AlertTriangle,
    className: 'text-destructive border-destructive/40',
  },
  cancelled: {
    label: 'Cancelled',
    icon: XCircle,
    className: 'text-muted-foreground border-border',
  },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.queued;
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={`gap-1 text-xs font-normal ${meta.className}`}>
      <Icon className={`h-3 w-3 ${meta.spin ? 'animate-spin' : ''}`} />
      {meta.label}
    </Badge>
  );
}

export function runStatusLabel(status: RunStatus): string {
  return (STATUS_META[status] ?? STATUS_META.queued).label;
}

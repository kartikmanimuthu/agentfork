'use client';

import { useState } from 'react';
import { ChevronDown, ClipboardList, Circle, CircleDot, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PlanStep {
  step: string;
  status: string;
}

function StepIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />;
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  if (status === 'in_progress') return <CircleDot className="h-3.5 w-3.5 shrink-0 text-blue-600" />;
  return <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

export function PlanningSection({ plan }: { plan: PlanStep[] }) {
  const [open, setOpen] = useState(true);
  if (!plan || plan.length === 0) return null;

  const done = plan.filter((s) => s.status === 'completed').length;

  return (
    <div className="mb-2 max-w-[75%] overflow-hidden rounded-lg border bg-muted/30 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium tracking-wide text-muted-foreground hover:bg-muted/50"
      >
        <ClipboardList className="h-3.5 w-3.5" />
        <span className="uppercase">Planning</span>
        <span className="text-muted-foreground/70">
          {done}/{plan.length} done
        </span>
        <ChevronDown className={cn('ml-auto h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="space-y-1.5 border-t px-3 py-2">
          {plan.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <StepIcon status={s.status} />
              <span className={cn(s.status === 'completed' && 'line-through opacity-70')}>{s.step}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

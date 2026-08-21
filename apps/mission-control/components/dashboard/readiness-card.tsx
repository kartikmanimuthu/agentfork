'use client';

import Link from 'next/link';
import { Check, ChevronRight, Circle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ZoneCard } from './zone-card';
import type { ReadinessZone, ZoneResult } from '@chatbot/claw-studio';

export function ReadinessCard({
  zone,
  loading,
}: {
  zone: ZoneResult<ReadinessZone> | undefined;
  loading: boolean;
}) {
  return (
    <ZoneCard
      title="Readiness"
      zone={zone}
      loading={loading}
      skeleton={
        <div className="space-y-3">
          <Skeleton className="h-2 w-full" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      }
    >
      {(d) => {
        const pct = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0;
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Setup complete</span>
                <span className="font-medium">
                  {d.completed}/{d.total}
                </span>
              </div>
              {/* Pure-CSS bar — no chart library on this page, per the design doc. */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            <div className="space-y-1">
              {d.items.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex items-center gap-2 rounded-md border border-transparent p-2 text-sm hover:border-border hover:bg-accent/40"
                >
                  {/* Status is icon + label, never colour alone. */}
                  {item.done ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className={item.done ? 'flex-1' : 'flex-1 text-muted-foreground'}>
                    {item.label}
                  </span>
                  {item.done ? null : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </Link>
              ))}
            </div>

            {d.completed < d.total ? (
              <p className="text-xs text-muted-foreground">
                {d.items.find((i) => !i.done)?.hint}
              </p>
            ) : null}
          </div>
        );
      }}
    </ZoneCard>
  );
}

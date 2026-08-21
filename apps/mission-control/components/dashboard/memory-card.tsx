'use client';

import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { ZoneCard, ZoneLabel } from './zone-card';
import type { MemoryZone, ZoneResult } from '@chatbot/claw-studio';

const KIND_BAR: Record<string, string> = {
  SEMANTIC: 'bg-blue-500',
  PROCEDURAL: 'bg-violet-500',
  EPISODIC: 'bg-amber-500',
};

/**
 * Episodic memory keys are internal thread ids (`thread-claw_<id>_<id>`), which
 * would read as gibberish in a "top memories" list — the design doc flags nucleus
 * surfacing a raw id as "Top User" as a defect. Give them a readable label instead.
 */
function displayKey(key: string, kind: string): string {
  if (kind === 'EPISODIC' && key.startsWith('thread-')) return 'Conversation episode';
  return key;
}

function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function MemoryCard({
  zone,
  loading,
}: {
  zone: ZoneResult<MemoryZone> | undefined;
  loading: boolean;
}) {
  return (
    <ZoneCard
      title="Memory & Learning"
      zone={zone}
      loading={loading}
      skeleton={
        <div className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      }
    >
      {(d) => {
        if (d.total === 0) {
          return (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <p>Nothing learned yet.</p>
              <Link href="/chat" className="mt-1 inline-block text-primary hover:underline">
                Talk to Claw →
              </Link>
            </div>
          );
        }

        const maxKind = Math.max(...d.byKind.map((k) => k.count), 1);
        const maxTrend = Math.max(...d.writeTrend.map((p) => p.count), 1);

        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <ZoneLabel>By kind</ZoneLabel>
              {d.byKind.map((k) => (
                <div key={k.kind} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 truncate capitalize text-muted-foreground">
                    {k.kind.toLowerCase()}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${KIND_BAR[k.kind] ?? 'bg-slate-400'}`}
                      style={{ width: `${Math.max((k.count / maxKind) * 100, 4)}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right font-medium">{k.count}</span>
                </div>
              ))}
            </div>

            {d.topAccessed.length > 0 ? (
              <div className="space-y-1.5">
                <ZoneLabel>Most used</ZoneLabel>
                {d.topAccessed.map((m) => (
                  <Link
                    key={m.id}
                    href="/memory"
                    className="flex items-center gap-2 rounded-md border border-transparent p-1.5 text-sm hover:border-border hover:bg-accent/40"
                  >
                    <span className="flex-1 truncate">{displayKey(m.key, m.kind)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {m.accessCount}&times;
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}

            {d.writeTrend.length > 0 ? (
              <div className="space-y-1.5">
                {/* Labelled "writes", not "activity" — they are not the same thing. */}
                <ZoneLabel>Memory writes</ZoneLabel>
                <div className="flex h-12 items-end gap-1">
                  {d.writeTrend.map((p) => (
                    <div
                      key={p.day}
                      className="flex-1 rounded-sm bg-blue-500/30 hover:bg-blue-500/50"
                      style={{ height: `${Math.max((p.count / maxTrend) * 100, 4)}%` }}
                      title={`${formatDay(p.day)}: ${p.count} written`}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{formatDay(d.writeTrend[0].day)}</span>
                  {d.writeTrend.length > 1 ? (
                    <span>{formatDay(d.writeTrend[d.writeTrend.length - 1].day)}</span>
                  ) : null}
                </div>
                {d.writeTrend.length === 1 ? (
                  <p className="text-[10px] text-muted-foreground">
                    Single day of data — the trend fills in with use.
                  </p>
                ) : null}
                {d.truncated ? (
                  <p className="text-[10px] text-amber-600 dark:text-amber-500">
                    Trend capped at the row limit — older writes are not shown.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      }}
    </ZoneCard>
  );
}

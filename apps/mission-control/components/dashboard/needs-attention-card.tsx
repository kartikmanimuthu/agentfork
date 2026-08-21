'use client';

import Link from 'next/link';
import { CheckCircle2, ChevronRight, AlertTriangle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ZoneCard, CountBadge } from './zone-card';
import type { AttentionZone, ZoneResult } from '@chatbot/claw-studio';

export function NeedsAttentionCard({
  zone,
  loading,
}: {
  zone: ZoneResult<AttentionZone> | undefined;
  loading: boolean;
}) {
  return (
    <ZoneCard
      title="Needs attention"
      zone={zone}
      loading={loading}
      badge={zone?.ok ? <CountBadge count={zone.data.total} /> : null}
      skeleton={
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      }
    >
      {(d) => {
        // Bounded height + scroll rather than letting the card grow with the
        // check count: `getAttentionZone` now has 6 checks (was 3) and will
        // likely gain more, so a fixed list would either keep stretching this
        // card taller than its sibling forever, or (worse) get capped by
        // truncating checks silently. Scrolling keeps every check visible
        // without either.
        if (d.total === 0) {
          return (
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
                <span>Nothing needs your attention.</span>
              </div>
              {/* Each check is still listed so a clean state reads as "checked and
                  clear", not as a card that failed to load. */}
              <div className="space-y-1">
                {d.groups.map((g) => (
                  <p key={g.id} className="text-xs text-muted-foreground">
                    · {g.emptyCopy}
                  </p>
                ))}
              </div>
            </div>
          );
        }

        return (
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {d.groups
              .filter((g) => g.count > 0)
              .map((g) => (
                <Link
                  key={g.id}
                  href={g.href}
                  className="flex items-center gap-2 rounded-md border border-transparent p-2 text-sm hover:border-amber-500/40 hover:bg-amber-500/5"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
                  <span className="flex-1">{g.label}</span>
                  <span className="shrink-0 font-medium">{g.count}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            {d.groups
              .filter((g) => g.count === 0)
              .map((g) => (
                <p key={g.id} className="px-2 text-xs text-muted-foreground">
                  · {g.emptyCopy}
                </p>
              ))}
          </div>
        );
      }}
    </ZoneCard>
  );
}

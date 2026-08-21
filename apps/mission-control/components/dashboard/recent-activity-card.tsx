'use client';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ZoneCard, ZoneLabel } from './zone-card';
import type { ActivityZone, ZoneResult } from '@chatbot/claw-studio';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITY_CLASS: Record<string, string> = {
  critical: 'text-red-700 dark:text-red-400 border-red-500/40',
  high: 'text-orange-700 dark:text-orange-400 border-orange-500/40',
  medium: 'text-amber-700 dark:text-amber-400 border-amber-500/40',
  low: 'text-blue-700 dark:text-blue-400 border-blue-500/40',
  info: 'text-muted-foreground',
};

/**
 * Some writers store a bare verb in `action` ("update", "create" from
 * ClawStudio.*), which renders as an uninformative row. When that happens the
 * eventType carries the real meaning, so humanise that instead.
 */
function displayAction(action: string, eventType: string): string {
  const bareVerb = /^[a-z]+$/.test(action.trim());
  if (!bareVerb) return action;
  const label = eventType.replace(/[._]/g, ' ').trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function RecentActivityCard({
  zone,
  loading,
}: {
  zone: ZoneResult<ActivityZone> | undefined;
  loading: boolean;
}) {
  return (
    <ZoneCard
      title="Recent activity"
      zone={zone}
      loading={loading}
      skeleton={
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      }
    >
      {(d) => {
        if (d.recent.length === 0) {
          return (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No audited activity in this period.
            </p>
          );
        }

        const bySeverity = [...d.bySeverity].sort(
          (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
        );

        return (
          <div className="space-y-3">
            {bySeverity.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {bySeverity.map((s) => (
                  <Badge
                    key={s.severity}
                    variant="outline"
                    className={`text-xs ${SEVERITY_CLASS[s.severity] ?? ''}`}
                  >
                    {s.severity} {s.count}
                  </Badge>
                ))}
              </div>
            ) : null}

            <div className="space-y-1">
              <ZoneLabel>Latest events</ZoneLabel>
              {/* Rows are intentionally not links: Mission Control has no audit
                  detail page yet, and a link that 404s is worse than no link. */}
              {d.recent.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm"
                  title={e.eventType}
                >
                  <span className="flex-1 truncate">{displayAction(e.action, e.eventType)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(e.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      }}
    </ZoneCard>
  );
}

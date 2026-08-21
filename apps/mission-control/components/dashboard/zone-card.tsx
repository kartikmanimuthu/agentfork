'use client';

import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { ZoneResult } from '@chatbot/claw-studio';

interface ZoneCardProps<T> {
  title: string;
  /** Undefined while the request is in flight. */
  zone: ZoneResult<T> | undefined;
  loading: boolean;
  badge?: ReactNode;
  /** Shape-matched skeleton — the design doc calls for these over spinners. */
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}

/**
 * Wraps a zone in the error → loading → data contract so one failing zone shows
 * an inline card while its siblings keep working.
 */
export function ZoneCard<T>({ title, zone, loading, badge, skeleton, children }: ZoneCardProps<T>) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        {badge}
      </CardHeader>
      <CardContent className="flex-1">
        {loading || !zone ? (
          skeleton ?? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )
        ) : !zone.ok ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{zone.error}</span>
          </div>
        ) : (
          children(zone.data)
        )}
      </CardContent>
    </Card>
  );
}

export function ZoneLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs uppercase text-muted-foreground">{children}</p>;
}

export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return <Badge variant="destructive">{count}</Badge>;
}

'use client';

import { useState } from 'react';
import { LayoutDashboard, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeaderTitle } from '@/components/ui/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDashboard } from '@/hooks/use-dashboard';
import type { DashboardRange } from '@chatbot/claw-studio';
import { HeroKpis } from './hero-kpis';
import { ReadinessCard } from './readiness-card';
import { MemoryCard } from './memory-card';
import { NeedsAttentionCard } from './needs-attention-card';
import { RecentActivityCard } from './recent-activity-card';

const RANGE_LABELS: Record<DashboardRange, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

export function DashboardClient() {
  const [range, setRange] = useState<DashboardRange>('30d');
  const { data, isLoading, isFetching, refetch, error } = useDashboard(range);

  return (
    <div className="space-y-6" data-testid="mission-dashboard">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageHeaderTitle icon={LayoutDashboard} title="Mission Dashboard" description="Is Claw set up, working, and learning — and what needs you?" />
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={(v) => setRange(v as DashboardRange)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RANGE_LABELS) as DashboardRange[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {RANGE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh dashboard"
          >
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load the dashboard.'}
        </div>
      ) : null}

      <HeroKpis zone={data?.hero} loading={isLoading} />

      {/* Width encodes importance: triage is 2/3, trust panel is 1/3.
          `items-start` instead of the grid default `items-stretch`: with
          stretch, whichever card has less content (typically NeedsAttention
          on a clean "nothing to do" day) got force-stretched to match
          Readiness's taller checklist, leaving dead space inside its
          CardContent (which is `flex-1`) rather than the card just being
          shorter. Cards now size to their own content instead. */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NeedsAttentionCard zone={data?.attention} loading={isLoading} />
        </div>
        <ReadinessCard zone={data?.readiness} loading={isLoading} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <MemoryCard zone={data?.memory} loading={isLoading} />
        <RecentActivityCard zone={data?.activity} loading={isLoading} />
      </div>
    </div>
  );
}

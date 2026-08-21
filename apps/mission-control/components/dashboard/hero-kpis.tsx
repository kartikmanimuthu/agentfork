'use client';

import Link from 'next/link';
import { Brain, Sparkles, Server, Cpu, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { HeroZone, ZoneResult } from '@chatbot/claw-studio';

interface KpiProps {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Brain;
  href: string;
  /** Renders the value muted with a setup prompt instead of a confident number. */
  unset?: boolean;
  /** Which chart-color token tints this KPI's icon well — a light rotation
   *  across the four tiles reads as "designed", flat muted-gray on all four
   *  reads as an afterthought. Kept subtle (low-opacity tint), not a full
   *  color block, to stay in the "minimalistic and professional" lane. */
  tint: 'primary' | 'chart-2' | 'chart-3' | 'chart-4';
}

function Kpi({ label, value, sub, icon: Icon, href, unset, tint }: KpiProps) {
  return (
    <Link href={href}>
      <Card className="glass-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <div
              className={cn(
                'rounded-md p-2',
                tint === 'primary' ? 'bg-primary/10 text-primary' : `tint-${tint}`,
              )}
            >
              <Icon className="h-4 w-4" />
            </div>
          </div>
          <p
            className={
              unset ? 'mt-2 text-base font-medium text-muted-foreground' : 'mt-2 text-2xl font-semibold'
            }
          >
            {value}
          </p>
          {sub ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p> : null}
        </CardContent>
      </Card>
    </Link>
  );
}

export function HeroKpis({ zone, loading }: { zone: ZoneResult<HeroZone> | undefined; loading: boolean }) {
  if (loading || !zone) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (!zone.ok) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{zone.error}</span>
      </div>
    );
  }

  const d = zone.data;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi
        label="Memories"
        value={d.memories.toLocaleString()}
        sub="learned across sessions"
        icon={Brain}
        href="/memory"
        tint="primary"
      />
      <Kpi
        label="Skills enabled"
        value={String(d.skillsEnabled)}
        sub={d.skillsTotal > d.skillsEnabled ? `${d.skillsTotal} total` : 'all enabled'}
        icon={Sparkles}
        href="/skills"
        tint="chart-4"
      />
      <Kpi
        label="Tool servers"
        value={String(d.activeTools)}
        sub="active MCP connections"
        icon={Server}
        href="/mcp"
        tint="chart-2"
      />
      <Kpi
        label="LLM provider"
        value={d.provider ? d.provider.name : 'Not configured'}
        sub={d.provider?.chatModel ?? 'Claw cannot answer without a model'}
        icon={Cpu}
        href="/llm-providers"
        unset={!d.provider}
        tint="chart-3"
      />
    </div>
  );
}

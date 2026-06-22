'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { ReportResult, VizType, VizConfig } from '@/lib/reports/types';

const PALETTE = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

/**
 * Renders a ReportResult as a chart using a column mapping (vizConfig).
 *  - xKey:      category / x-axis column (defaults to first column)
 *  - yKeys:     numeric series columns (defaults to first non-x column)
 *  - seriesKey: optional — pivots yKeys[0] into one series per distinct value
 */
export function ReportChart({
  result,
  vizType,
  vizConfig,
}: {
  result: ReportResult;
  vizType: VizType;
  vizConfig: VizConfig;
}) {
  const { rows, columns } = result;
  if (!rows.length) return <EmptyState message="No rows to chart." />;

  const xKey = vizConfig.xKey && columns.includes(vizConfig.xKey) ? vizConfig.xKey : columns[0];
  const configuredY = (vizConfig.yKeys ?? []).filter((k) => columns.includes(k));
  const yKeys = configuredY.length ? configuredY : columns.filter((c) => c !== xKey).slice(0, 1);
  const seriesKey =
    vizConfig.seriesKey && columns.includes(vizConfig.seriesKey) ? vizConfig.seriesKey : undefined;

  if (yKeys.length === 0) return <EmptyState message="Pick a numeric column to plot." />;

  if (vizType === 'kpi') {
    const value = toNumber(rows[0]?.[yKeys[0]]);
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <span className="text-4xl font-semibold tabular-nums">{value.toLocaleString()}</span>
        <span className="mt-1 text-sm text-muted-foreground">{yKeys[0]}</span>
      </div>
    );
  }

  // Build chart data + the list of series to draw.
  let data: Record<string, unknown>[];
  let series: string[];
  if (seriesKey) {
    const yk = yKeys[0];
    const byX = new Map<string, Record<string, unknown>>();
    const names = new Set<string>();
    for (const r of rows) {
      const xv = String(r[xKey] ?? '');
      const sv = String(r[seriesKey] ?? '—');
      names.add(sv);
      const entry = byX.get(xv) ?? { [xKey]: xv };
      entry[sv] = toNumber(r[yk]);
      byX.set(xv, entry);
    }
    data = [...byX.values()];
    series = [...names];
  } else {
    data = rows.map((r) => {
      const o: Record<string, unknown> = { [xKey]: String(r[xKey] ?? '') };
      for (const yk of yKeys) o[yk] = toNumber(r[yk]);
      return o;
    });
    series = yKeys;
  }

  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [s, { label: s, color: PALETTE[i % PALETTE.length] }]),
  );

  if (vizType === 'pie') {
    const yk = yKeys[0];
    const pieData = rows.map((r) => ({ name: String(r[xKey] ?? ''), value: toNumber(r[yk]) }));
    return (
      <ChartContainer config={config} className="h-full w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent />} />
          <Pie data={pieData} dataKey="value" nameKey="name" innerRadius="40%">
            {pieData.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
    );
  }

  if (vizType === 'bar') {
    return (
      <ChartContainer config={config} className="h-full w-full">
        <BarChart data={data}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {series.length > 1 && <Legend />}
          {series.map((s, i) => (
            <Bar key={s} dataKey={s} fill={PALETTE[i % PALETTE.length]} radius={3} />
          ))}
        </BarChart>
      </ChartContainer>
    );
  }

  const ChartEl = vizType === 'area' ? AreaChart : LineChart;
  return (
    <ChartContainer config={config} className="h-full w-full">
      <ChartEl data={data}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {series.length > 1 && <Legend />}
        {series.map((s, i) =>
          vizType === 'area' ? (
            <Area
              key={s}
              dataKey={s}
              type="monotone"
              stroke={PALETTE[i % PALETTE.length]}
              fill={PALETTE[i % PALETTE.length]}
              fillOpacity={0.15}
            />
          ) : (
            <Line
              key={s}
              dataKey={s}
              type="monotone"
              stroke={PALETTE[i % PALETTE.length]}
              dot={false}
            />
          ),
        )}
      </ChartEl>
    </ChartContainer>
  );
}

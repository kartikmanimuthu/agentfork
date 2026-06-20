'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { QueryResultRow, VizType } from '@/lib/dashboards/types';

const PALETTE = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

const config: ChartConfig = { value: { label: 'Value', color: 'hsl(var(--primary))' } };

function formatLabel(label: string): string {
  // time-series labels are ISO strings; show a short date
  const d = new Date(label);
  return Number.isNaN(d.getTime()) ? label : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function WidgetRenderer({ vizType, data }: { vizType: VizType; data: QueryResultRow[] }) {
  if (!data || data.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data</div>;
  }

  if (vizType === 'kpi') {
    const value = data[0]?.value ?? 0;
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <span className="text-4xl font-semibold tabular-nums">{value.toLocaleString()}</span>
        <span className="mt-1 text-sm text-muted-foreground">{data[0]?.label}</span>
      </div>
    );
  }

  const chartData = data.map((r) => ({ label: formatLabel(r.label), value: r.value }));

  if (vizType === 'pie') {
    return (
      <ChartContainer config={config} className="h-full w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent />} />
          <Pie data={chartData} dataKey="value" nameKey="label" innerRadius="40%">
            {chartData.map((_, i) => (
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
        <BarChart data={chartData}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} fontSize={11} width={32} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="value" fill="hsl(var(--primary))" radius={4} />
        </BarChart>
      </ChartContainer>
    );
  }

  const Chart = vizType === 'area' ? AreaChart : LineChart;
  return (
    <ChartContainer config={config} className="h-full w-full">
      <Chart data={chartData}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={32} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {vizType === 'area' ? (
          <Area dataKey="value" type="monotone" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} />
        ) : (
          <Line dataKey="value" type="monotone" stroke="hsl(var(--primary))" dot={false} />
        )}
      </Chart>
    </ChartContainer>
  );
}

'use client';

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

interface Conversation {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

interface ActivityChartProps {
  conversations: Conversation[];
}

export function ActivityChart({ conversations }: ActivityChartProps) {
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    const now = new Date();

    // Initialize last 7 days with 0
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      counts.set(key, 0);
    }

    // Count conversations per day
    conversations.forEach((conv) => {
      const date = new Date(conv.updatedAt);
      const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays <= 6) {
        const key = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });

    return Array.from(counts.entries()).map(([date, conversations]) => ({
      date,
      conversations,
    }));
  }, [conversations]);

  const chartConfig = {
    conversations: {
      label: 'Conversations',
      color: 'hsl(var(--primary))',
    },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Conversations over the last 7 days</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-[3/1] w-full min-h-[200px]">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <defs>
              <linearGradient id="fillActivity" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => value.split(' ')[1]}
            />
            <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
            <ChartTooltip
              cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 4' }}
              content={<ChartTooltipContent indicator="line" />}
            />
            <Area
              dataKey="conversations"
              type="monotone"
              fill="url(#fillActivity)"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

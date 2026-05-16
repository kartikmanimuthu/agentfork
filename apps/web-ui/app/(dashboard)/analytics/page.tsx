'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  MessageSquare, Users, CheckCircle2, XCircle, TrendingUp, TrendingDown, BarChart3, Activity,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Label,
} from 'recharts';

const COLORS = {
  positive: '#10B981',
  negative: '#EF4444',
  neutral: '#6366F1',
  mixed: '#F59E0B',
  resolved: '#10B981',
  unresolved: '#EF4444',
};

function KpiCard({ title, value, subtitle, icon, loading }: {
  title: string; value: string | number; subtitle?: string; icon: React.ReactNode; loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <>
            <div className="text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</div>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TopQueryList({ items, color, emptyMsg }: {
  items: Array<{ query: string; count: number }>; color: string; emptyMsg: string;
}) {
  if (!items || items.length === 0) {
    return <div className="text-center py-6 text-muted-foreground text-sm">{emptyMsg}</div>;
  }
  const max = items[0]?.count || 1;
  return (
    <div className="space-y-2">
      {items.slice(0, 5).map((item, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium truncate flex-1">{i + 1}. {item.query}</span>
            <Badge variant="secondary" className="text-xs shrink-0">{item.count}</Badge>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(item.count / max) * 100}%`, backgroundColor: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsDashboardPage() {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({ fromDate: '', toDate: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-summary', appliedFilters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (appliedFilters.fromDate) params.append('fromDate', appliedFilters.fromDate);
      if (appliedFilters.toDate) params.append('toDate', appliedFilters.toDate);
      const res = await fetch(`/api/analytics/summary?${params}`);
      if (!res.ok) throw new Error('Failed to fetch analytics');
      return res.json();
    },
    staleTime: 1000 * 60 * 3,
  });

  const handleApply = () => setAppliedFilters({ fromDate, toDate });
  const handleClear = () => { setFromDate(''); setToDate(''); setAppliedFilters({ fromDate: '', toDate: '' }); };

  const sentimentData = data ? [
    { name: 'Positive', value: data.sentimentDistribution.positive },
    { name: 'Negative', value: data.sentimentDistribution.negative },
    { name: 'Neutral', value: data.sentimentDistribution.neutral },
    { name: 'Mixed', value: data.sentimentDistribution.mixed },
  ].filter(d => d.value > 0) : [];

  const resolutionData = data ? [
    { name: 'Resolved', value: data.counts.resolved },
    { name: 'Unresolved', value: data.counts.unresolved },
  ].filter(d => d.value > 0) : [];

  const totalSentiment = sentimentData.reduce((a, b) => a + b.value, 0);
  const totalResolution = resolutionData.reduce((a, b) => a + b.value, 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="text-xs font-medium text-muted-foreground">From</label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">To</label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
        </div>
        <Button onClick={handleApply} size="sm">Apply</Button>
        <Button onClick={handleClear} variant="outline" size="sm">Clear</Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard title="Total Conversations" value={data?.counts.total ?? 0} icon={<MessageSquare className="h-4 w-4" />} loading={isLoading} />
        <KpiCard title="Active Sessions" value={data?.counts.active ?? 0} icon={<Activity className="h-4 w-4" />} loading={isLoading} />
        <KpiCard title="Completed" value={data?.counts.completed ?? 0} icon={<CheckCircle2 className="h-4 w-4" />} loading={isLoading} />
        <KpiCard title="Resolution Rate" value={`${data?.resolutionRate ?? 0}%`} icon={<TrendingUp className="h-4 w-4" />} loading={isLoading} />
        <KpiCard title="Analyzed" value={data?.counts.analyzed ?? 0} icon={<BarChart3 className="h-4 w-4" />} loading={isLoading} />
        <KpiCard title="NPS Score" value={data?.nps.score ?? 0} subtitle={`${data?.nps.totalWithRatings ?? 0} ratings`} icon={<Users className="h-4 w-4" />} loading={isLoading} />
      </div>

      {/* Sentiment + Resolution Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="text-center pb-0">
            <CardTitle>Sentiment Distribution</CardTitle>
            <CardDescription>Across analyzed conversations</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-64 w-full" /> : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip formatter={(v) => [`${v} (${totalSentiment > 0 ? ((Number(v) / totalSentiment) * 100).toFixed(0) : 0}%)`, '']} />
                    <Pie data={sentimentData} nameKey="name" dataKey="value" innerRadius={60} outerRadius={90} paddingAngle={3} strokeWidth={0}>
                      {sentimentData.map((entry) => (
                        <Cell key={entry.name} fill={COLORS[entry.name.toLowerCase() as keyof typeof COLORS]} />
                      ))}
                      <Label content={({ viewBox }) => {
                        if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                          return (
                            <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                              <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-2xl font-bold">{totalSentiment}</tspan>
                              <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 18} className="fill-muted-foreground text-xs">Total</tspan>
                            </text>
                          );
                        }
                      }} />
                    </Pie>
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="text-center pb-0">
            <CardTitle>Resolution Status</CardTitle>
            <CardDescription>Resolved vs Unresolved</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-64 w-full" /> : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip formatter={(v) => [`${v} (${totalResolution > 0 ? ((Number(v) / totalResolution) * 100).toFixed(0) : 0}%)`, '']} />
                    <Pie data={resolutionData} nameKey="name" dataKey="value" innerRadius={60} outerRadius={90} paddingAngle={3} strokeWidth={0}>
                      {resolutionData.map((entry) => (
                        <Cell key={entry.name} fill={entry.name === 'Resolved' ? COLORS.resolved : COLORS.unresolved} />
                      ))}
                      <Label content={({ viewBox }) => {
                        if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                          return (
                            <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                              <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-2xl font-bold">{totalResolution}</tspan>
                              <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 18} className="fill-muted-foreground text-xs">Queries</tspan>
                            </text>
                          );
                        }
                      }} />
                    </Pie>
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Trends */}
      {data?.trends?.sentiment?.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Sentiment Trends</CardTitle>
              <CardDescription>Over time</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.trends.sentiment} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="date" fontSize={11} angle={-30} textAnchor="end" height={45}
                      tickFormatter={(d) => { const dt = new Date(d); return `${dt.getDate()}/${dt.getMonth() + 1}`; }} />
                    <YAxis fontSize={11} />
                    <Tooltip labelFormatter={(d) => new Date(d).toLocaleDateString()} />
                    <Legend />
                    <Area type="monotone" dataKey="positive" stackId="1" stroke={COLORS.positive} fill={COLORS.positive} fillOpacity={0.3} />
                    <Area type="monotone" dataKey="negative" stackId="1" stroke={COLORS.negative} fill={COLORS.negative} fillOpacity={0.3} />
                    <Area type="monotone" dataKey="neutral" stackId="1" stroke={COLORS.neutral} fill={COLORS.neutral} fillOpacity={0.3} />
                    <Area type="monotone" dataKey="mixed" stackId="1" stroke={COLORS.mixed} fill={COLORS.mixed} fillOpacity={0.3} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resolution Trends</CardTitle>
              <CardDescription>Resolved vs Unresolved over time</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.trends.resolution} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="date" fontSize={11} angle={-30} textAnchor="end" height={45}
                      tickFormatter={(d) => { const dt = new Date(d); return `${dt.getDate()}/${dt.getMonth() + 1}`; }} />
                    <YAxis fontSize={11} />
                    <Tooltip labelFormatter={(d) => new Date(d).toLocaleDateString()} />
                    <Legend />
                    <Area type="monotone" dataKey="resolved" stroke={COLORS.resolved} fill={COLORS.resolved} fillOpacity={0.3} />
                    <Area type="monotone" dataKey="unresolved" stroke={COLORS.unresolved} fill={COLORS.unresolved} fillOpacity={0.3} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Top Queries */}
      <div>
        <h2 className="text-xl font-semibold mb-3">Top User Queries</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Most Asked</CardTitle>
            </CardHeader>
            <CardContent>
              <TopQueryList items={data?.topQueries?.mostAsked || []} color={COLORS.neutral} emptyMsg="No data yet" />
            </CardContent>
          </Card>
          <Card className="border-emerald-200 dark:border-emerald-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-500" /> Positive
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TopQueryList items={data?.topQueries?.positive || []} color={COLORS.positive} emptyMsg="No positive queries" />
            </CardContent>
          </Card>
          <Card className="border-red-200 dark:border-red-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-500" /> Negative
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TopQueryList items={data?.topQueries?.negative || []} color={COLORS.negative} emptyMsg="No negative queries" />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* NPS */}
      {data?.nps && data.nps.totalWithRatings > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-3">NPS</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="text-center pb-0">
                <CardTitle>NPS Score</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center py-6">
                <div className="text-5xl font-bold" style={{
                  color: data.nps.score >= 50 ? COLORS.positive : data.nps.score >= 0 ? COLORS.mixed : COLORS.negative
                }}>
                  {data.nps.score}
                </div>
                <p className="text-sm text-muted-foreground mt-2">Based on {data.nps.totalWithRatings} ratings</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rating Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[5, 4, 3, 2, 1].map((r) => {
                    const count = data.nps.ratingDistribution[r] || 0;
                    const pct = data.nps.totalWithRatings > 0 ? (count / data.nps.totalWithRatings) * 100 : 0;
                    return (
                      <div key={r} className="flex items-center gap-2">
                        <span className="text-sm w-8">{r} ★</span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-yellow-400" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-12 text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-emerald-600 font-medium">Promoters (4-5)</span>
                  <Badge variant="secondary">{data.nps.promoters}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Passives (3)</span>
                  <Badge variant="secondary">{data.nps.passives}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-red-500 font-medium">Detractors (1-2)</span>
                  <Badge variant="secondary">{data.nps.detractors}</Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

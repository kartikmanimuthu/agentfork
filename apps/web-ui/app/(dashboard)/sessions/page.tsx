'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, Search, MessageSquare, Clock, CheckCircle2, Activity } from 'lucide-react';

const SENTIMENT_COLORS: Record<string, string> = {
  POSITIVE: '#10B981',
  NEGATIVE: '#EF4444',
  NEUTRAL: '#6366F1',
  MIXED: '#F59E0B',
};

interface SessionRow {
  id: string;
  name: string | null;
  channel: string;
  status: string;
  startedAt: string;
  lastActivityAt: string;
  endedAt: string | null;
  endReason: string | null;
  messageCount: number;
  executionCount: number;
  avgLatencyMs: number | null;
  agent: { id: string; name: string; type: string } | null;
  agentVersion: { id: string; version: number; status: string } | null;
  analytics: {
    sentiment: string | null;
    isResolved: boolean | null;
    confidenceScore: number | null;
    firstUserQuery: string | null;
    summary: string | null;
  } | null;
}

interface Filters {
  channel: string;
  status: string;
  sentiment: string;
  resolvedStatus: string;
  fromDate: string;
  toDate: string;
  search: string;
  page: number;
}

const DEFAULT_FILTERS: Filters = {
  channel: 'all',
  status: 'all',
  sentiment: 'all',
  resolvedStatus: 'all',
  fromDate: '',
  toDate: '',
  search: '',
  page: 1,
};

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-6 pb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function SessionsPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<Filters>(DEFAULT_FILTERS);

  const { data, isLoading } = useQuery({
    queryKey: ['sessions', applied],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (applied.channel !== 'all') params.append('channel', applied.channel);
      if (applied.status !== 'all') params.append('status', applied.status);
      if (applied.sentiment !== 'all') params.append('sentiment', applied.sentiment);
      if (applied.resolvedStatus !== 'all') params.append('resolvedStatus', applied.resolvedStatus);
      if (applied.fromDate) params.append('fromDate', applied.fromDate);
      if (applied.toDate) params.append('toDate', applied.toDate);
      if (applied.search) params.append('search', applied.search);
      params.append('page', String(applied.page));
      params.append('limit', '20');
      const res = await fetch(`/api/sessions?${params}`);
      if (!res.ok) throw new Error('Failed to fetch sessions');
      return res.json() as Promise<{
        sessions: SessionRow[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>;
    },
    staleTime: 1000 * 60 * 2,
  });

  const handleApply = () => setApplied({ ...filters, page: 1 });
  const handleClear = () => {
    setFilters(DEFAULT_FILTERS);
    setApplied(DEFAULT_FILTERS);
  };
  const setPage = (p: number) => {
    const updated = { ...applied, page: p };
    setFilters(updated);
    setApplied(updated);
  };

  const sessions = data?.sessions ?? [];
  const pagination = data?.pagination ?? { page: 1, totalPages: 1, total: 0, limit: 20 };

  const totalSessions = pagination.total;
  const activeSessions = sessions.filter((s) => s.status === 'active').length;
  const avgLatency = sessions.length > 0
    ? sessions.reduce((sum, s) => sum + (s.avgLatencyMs ?? 0), 0) / sessions.filter((s) => s.avgLatencyMs !== null).length
    : null;
  const totalMessages = sessions.reduce((sum, s) => sum + s.messageCount, 0);

  const formatLatency = (ms: number | null) => {
    if (ms === null || ms === undefined || isNaN(ms)) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Sessions</h1>
        <span className="text-sm text-muted-foreground">Inference sessions across all channels and agents</span>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6 pb-4">
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard
              label="Total Sessions"
              value={totalSessions.toLocaleString()}
              icon={<MessageSquare className="h-4 w-4" />}
            />
            <StatCard
              label="Active Sessions"
              value={String(activeSessions)}
              icon={<Activity className="h-4 w-4" />}
            />
            <StatCard
              label="Avg Latency"
              value={formatLatency(avgLatency)}
              icon={<Clock className="h-4 w-4" />}
            />
            <StatCard
              label="Total Messages"
              value={totalMessages.toLocaleString()}
              icon={<CheckCircle2 className="h-4 w-4" />}
            />
          </>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs font-medium text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by ID or name..."
                  value={filters.search}
                  onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && handleApply()}
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input
                type="date"
                value={filters.fromDate}
                onChange={(e) => setFilters((f) => ({ ...f, fromDate: e.target.value }))}
                className="w-36"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input
                type="date"
                value={filters.toDate}
                onChange={(e) => setFilters((f) => ({ ...f, toDate: e.target.value }))}
                className="w-36"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="ended">Ended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Channel</label>
              <Select value={filters.channel} onValueChange={(v) => setFilters((f) => ({ ...f, channel: v }))}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="API">API</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Sentiment</label>
              <Select value={filters.sentiment} onValueChange={(v) => setFilters((f) => ({ ...f, sentiment: v }))}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="POSITIVE">Positive</SelectItem>
                  <SelectItem value="NEGATIVE">Negative</SelectItem>
                  <SelectItem value="NEUTRAL">Neutral</SelectItem>
                  <SelectItem value="MIXED">Mixed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Resolution</label>
              <Select value={filters.resolvedStatus} onValueChange={(v) => setFilters((f) => ({ ...f, resolvedStatus: v }))}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="unresolved">Unresolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleApply} size="sm">Apply</Button>
            <Button onClick={handleClear} variant="outline" size="sm">Clear</Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No sessions found. Sessions are created when integrators call{' '}
              <code className="text-xs bg-muted px-1 rounded">POST /api/v1/inference</code> with a{' '}
              <code className="text-xs bg-muted px-1 rounded">sessionId</code>.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-4">Name / Query</th>
                    <th className="py-2 pr-4">Agent</th>
                    <th className="py-2 pr-4">Channel</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Messages</th>
                    <th className="py-2 pr-4">Avg Latency</th>
                    <th className="py-2 pr-4">Sentiment</th>
                    <th className="py-2 pr-4">Resolved</th>
                    <th className="py-2">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b last:border-b-0 cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => router.push(`/sessions/${s.id}`)}
                    >
                      <td className="py-2.5 pr-4 max-w-[200px]">
                        <div className="truncate font-medium text-sm">
                          {s.analytics?.firstUserQuery ?? s.name ?? 'Untitled'}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono">{s.id.slice(0, 12)}…</div>
                      </td>
                      <td className="py-2.5 pr-4">
                        {s.agent?.name ?? '—'}
                        {s.agentVersion ? (
                          <span className="text-muted-foreground ml-1 text-xs">v{s.agentVersion.version}</span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge variant="outline" className="text-[10px]">{s.channel}</Badge>
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge
                          variant={s.status === 'active' ? 'default' : 'secondary'}
                          className="text-[10px]"
                        >
                          {s.status}{s.endReason ? ` · ${s.endReason}` : ''}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-4 text-center">{s.messageCount}</td>
                      <td className="py-2.5 pr-4">{formatLatency(s.avgLatencyMs)}</td>
                      <td className="py-2.5 pr-4">
                        {s.analytics?.sentiment ? (
                          <Badge
                            variant="outline"
                            className="text-[10px]"
                            style={{
                              borderColor: SENTIMENT_COLORS[s.analytics.sentiment],
                              color: SENTIMENT_COLORS[s.analytics.sentiment],
                            }}
                          >
                            {s.analytics.sentiment}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        {s.analytics?.isResolved !== null && s.analytics?.isResolved !== undefined ? (
                          <Badge
                            variant="outline"
                            className="text-[10px]"
                            style={{
                              borderColor: s.analytics.isResolved ? '#10B981' : '#EF4444',
                              color: s.analytics.isResolved ? '#10B981' : '#EF4444',
                            }}
                          >
                            {s.analytics.isResolved ? 'Yes' : 'No'}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2.5 text-xs text-muted-foreground">{formatDate(s.startedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage(pagination.page - 1)}
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPage(pagination.page + 1)}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

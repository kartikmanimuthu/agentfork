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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';

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

  const formatLatency = (ms: number | null) => {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Sessions</h1>
        <span className="text-sm text-muted-foreground">
          Inference sessions across all channels and agents
        </span>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-medium text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by ID or name..."
                  value={filters.search}
                  onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
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
              <Select
                value={filters.resolvedStatus}
                onValueChange={(v) => setFilters((f) => ({ ...f, resolvedStatus: v }))}
              >
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
            <Button onClick={handleApply} size="sm">
              Apply
            </Button>
            <Button onClick={handleClear} variant="outline" size="sm">
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Status tabs */}
      <Tabs
        value={applied.status}
        onValueChange={(v) => {
          const updated = { ...filters, status: v, page: 1 };
          setFilters(updated);
          setApplied(updated);
        }}
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="ended">Ended</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* List */}
      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="py-4">
                <Skeleton className="h-12 w-full" />
              </CardContent>
            </Card>
          ))
        ) : sessions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No sessions found. Sessions are created when integrators call <code>/api/v1/inference</code> with a
              <code> sessionId</code>.
            </CardContent>
          </Card>
        ) : (
          sessions.map((s) => (
            <Card
              key={s.id}
              className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => router.push(`/sessions/${s.id}`)}
            >
              <CardContent className="py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium truncate">
                        {s.analytics?.firstUserQuery ?? s.name ?? 'Untitled session'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <span className="font-mono">{s.id.slice(0, 10)}…</span>
                      {s.agent && (
                        <span>
                          {s.agent.name}
                          {s.agentVersion ? ` · v${s.agentVersion.version}` : ''}
                        </span>
                      )}
                      <span>started {formatDate(s.startedAt)}</span>
                      <span>last {formatDate(s.lastActivityAt)}</span>
                      <span>{s.messageCount} msgs</span>
                      <span>avg latency {formatLatency(s.avgLatencyMs)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-xs">
                      {s.channel}
                    </Badge>
                    <Badge variant={s.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                      {s.status}
                      {s.endReason ? ` · ${s.endReason}` : ''}
                    </Badge>
                    {s.analytics?.sentiment && (
                      <Badge
                        variant="outline"
                        className="text-xs"
                        style={{
                          borderColor: SENTIMENT_COLORS[s.analytics.sentiment],
                          color: SENTIMENT_COLORS[s.analytics.sentiment],
                        }}
                      >
                        {s.analytics.sentiment}
                      </Badge>
                    )}
                    {s.analytics?.isResolved !== null && s.analytics?.isResolved !== undefined && (
                      <Badge
                        variant="outline"
                        className="text-xs"
                        style={{
                          borderColor: s.analytics.isResolved ? '#10B981' : '#EF4444',
                          color: s.analytics.isResolved ? '#10B981' : '#EF4444',
                        }}
                      >
                        {s.analytics.isResolved ? 'Resolved' : 'Unresolved'}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

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

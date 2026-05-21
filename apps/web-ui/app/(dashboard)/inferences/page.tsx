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
import { ChevronLeft, ChevronRight, Search, Zap, CheckCircle2, Clock, Database } from 'lucide-react';

interface ExecutionRow {
  id: string;
  agentId: string;
  agentVersionId: string | null;
  sessionId: string | null;
  status: string;
  latencyMs: number | null;
  tokenUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
  cacheHit: boolean;
  webhookStatus: string | null;
  createdAt: string;
  completedAt: string | null;
  agent: { id: string; name: string; type: string } | null;
  agentVersion: { id: string; version: number; status: string } | null;
}

interface Stats {
  total: number;
  successRate: number;
  avgLatencyMs: number | null;
  cacheHitRate: number;
}

interface Filters {
  search: string;
  agentId: string;
  status: string;
  type: string;
  cacheHit: string;
  fromDate: string;
  toDate: string;
  page: number;
}

const DEFAULT_FILTERS: Filters = {
  search: '',
  agentId: 'all',
  status: 'all',
  type: 'all',
  cacheHit: 'all',
  fromDate: '',
  toDate: '',
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

export default function InferencesPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<Filters>(DEFAULT_FILTERS);

  const { data, isLoading } = useQuery({
    queryKey: ['inferences', applied],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (applied.agentId !== 'all') params.append('agentId', applied.agentId);
      if (applied.status !== 'all') params.append('status', applied.status);
      if (applied.type !== 'all') params.append('type', applied.type);
      if (applied.cacheHit !== 'all') params.append('cacheHit', applied.cacheHit);
      if (applied.fromDate) params.append('fromDate', applied.fromDate);
      if (applied.toDate) params.append('toDate', applied.toDate);
      if (applied.search) params.append('search', applied.search);
      params.append('page', String(applied.page));
      params.append('limit', '20');
      const res = await fetch(`/api/inferences?${params}`);
      if (!res.ok) throw new Error('Failed to fetch inferences');
      return res.json() as Promise<{
        stats: Stats;
        executions: ExecutionRow[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>;
    },
    staleTime: 1000 * 60,
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

  const executions = data?.executions ?? [];
  const stats = data?.stats;
  const pagination = data?.pagination ?? { page: 1, totalPages: 1, total: 0, limit: 20 };

  const formatLatency = (ms: number | null) => {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

  const statusVariant = (s: string): 'default' | 'secondary' | 'destructive' => {
    if (s === 'completed') return 'default';
    if (s === 'failed') return 'destructive';
    return 'secondary';
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Inferences</h1>
        <span className="text-sm text-muted-foreground">All API inference calls across agents</span>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {isLoading || !stats ? (
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
              label="Total Inferences"
              value={stats.total.toLocaleString()}
              icon={<Zap className="h-4 w-4" />}
            />
            <StatCard
              label="Success Rate"
              value={`${(stats.successRate * 100).toFixed(1)}%`}
              icon={<CheckCircle2 className="h-4 w-4" />}
            />
            <StatCard
              label="Avg Latency"
              value={formatLatency(stats.avgLatencyMs)}
              icon={<Clock className="h-4 w-4" />}
            />
            <StatCard
              label="Cache Hit Rate"
              value={`${(stats.cacheHitRate * 100).toFixed(1)}%`}
              icon={<Database className="h-4 w-4" />}
            />
          </>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs font-medium text-muted-foreground">Search by ID</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Execution ID..."
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
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <Select value={filters.type} onValueChange={(v) => setFilters((f) => ({ ...f, type: v }))}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="stateful">Stateful</SelectItem>
                  <SelectItem value="stateless">Stateless</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Cache</label>
              <Select value={filters.cacheHit} onValueChange={(v) => setFilters((f) => ({ ...f, cacheHit: v }))}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="true">Hit</SelectItem>
                  <SelectItem value="false">Miss</SelectItem>
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
          ) : executions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No inferences found. Calls to{' '}
              <code className="text-xs bg-muted px-1 rounded">POST /api/v1/inference</code> appear here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-4">ID</th>
                    <th className="py-2 pr-4">Agent</th>
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Latency</th>
                    <th className="py-2 pr-4">Tokens</th>
                    <th className="py-2 pr-4">Cache</th>
                    <th className="py-2 pr-4">Webhook</th>
                    <th className="py-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((ex) => (
                    <tr
                      key={ex.id}
                      className="border-b last:border-b-0 cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => router.push(`/inferences/${ex.id}`)}
                    >
                      <td className="py-2 pr-4 font-mono text-xs">{ex.id.slice(0, 12)}…</td>
                      <td className="py-2 pr-4">
                        {ex.agent?.name ?? '—'}
                        {ex.agentVersion ? (
                          <span className="text-muted-foreground ml-1 text-xs">v{ex.agentVersion.version}</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={ex.sessionId ? 'default' : 'secondary'} className="text-[10px]">
                          {ex.sessionId ? 'Stateful' : 'Stateless'}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={statusVariant(ex.status)} className="text-[10px]">
                          {ex.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">{formatLatency(ex.latencyMs)}</td>
                      <td className="py-2 pr-4">
                        {ex.tokenUsage &&
                        typeof ex.tokenUsage === 'object' &&
                        'totalTokens' in ex.tokenUsage
                          ? (ex.tokenUsage as { totalTokens: number }).totalTokens
                          : '—'}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={ex.cacheHit ? 'default' : 'outline'} className="text-[10px]">
                          {ex.cacheHit ? 'Hit' : 'Miss'}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-xs">{ex.webhookStatus ?? '—'}</td>
                      <td className="py-2 text-xs text-muted-foreground">{formatDate(ex.createdAt)}</td>
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

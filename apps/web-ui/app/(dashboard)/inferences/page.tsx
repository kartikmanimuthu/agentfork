'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronLeft, ChevronRight, Search, Zap, CheckCircle2, Clock, Database, Settings2 } from 'lucide-react';

interface ExecutionRow {
  id: string;
  agentId: string;
  agentVersionId: string | null;
  sessionId: string | null;
  status: string;
  latencyMs: number | null;
  tokenUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
  cacheHit: boolean;
  cacheType: string | null;
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
  cacheType: string;
  fromDate: string;
  toDate: string;
  page: number;
}

const DEFAULT_FILTERS: Filters = {
  search: '',
  agentId: 'all',
  status: 'all',
  type: 'all',
  cacheType: 'all',
  fromDate: '',
  toDate: '',
  page: 1,
};

function formatLatency(ms: number | null) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function statusVariant(s: string): 'default' | 'secondary' | 'destructive' {
  if (s === 'completed') return 'default';
  if (s === 'failed') return 'destructive';
  return 'secondary';
}

const COLUMN_DEFS = [
  {
    id: 'id',
    label: 'ID',
    headerClassName: 'py-2 pr-4',
    cellClassName: 'py-2 pr-4 font-mono text-xs',
    renderCell: (ex: ExecutionRow) => `${ex.id.slice(0, 12)}…`,
  },
  {
    id: 'agent',
    label: 'Agent',
    headerClassName: 'py-2 pr-4',
    cellClassName: 'py-2 pr-4',
    renderCell: (ex: ExecutionRow) => (
      <>
        {ex.agent?.name ?? '—'}
        {ex.agentVersion ? (
          <span className="text-muted-foreground ml-1 text-xs">v{ex.agentVersion.version}</span>
        ) : null}
      </>
    ),
  },
  {
    id: 'type',
    label: 'Type',
    headerClassName: 'py-2 pr-4',
    cellClassName: 'py-2 pr-4',
    renderCell: (ex: ExecutionRow) => (
      <Badge variant={ex.sessionId ? 'default' : 'secondary'} className="text-[10px]">
        {ex.sessionId ? 'Stateful' : 'Stateless'}
      </Badge>
    ),
  },
  {
    id: 'status',
    label: 'Status',
    headerClassName: 'py-2 pr-4',
    cellClassName: 'py-2 pr-4',
    renderCell: (ex: ExecutionRow) => (
      <Badge variant={statusVariant(ex.status)} className="text-[10px]">
        {ex.status}
      </Badge>
    ),
  },
  {
    id: 'latency',
    label: 'Latency',
    headerClassName: 'py-2 pr-4',
    cellClassName: 'py-2 pr-4',
    renderCell: (ex: ExecutionRow) => formatLatency(ex.latencyMs),
  },
  {
    id: 'tokens',
    label: 'Tokens',
    headerClassName: 'py-2 pr-4',
    cellClassName: 'py-2 pr-4',
    renderCell: (ex: ExecutionRow) =>
      ex.tokenUsage && typeof ex.tokenUsage === 'object' && 'totalTokens' in ex.tokenUsage
        ? (ex.tokenUsage as { totalTokens: number }).totalTokens
        : '—',
  },
  {
    id: 'cache',
    label: 'Cache',
    headerClassName: 'py-2 pr-4',
    cellClassName: 'py-2 pr-4',
    renderCell: (ex: ExecutionRow) =>
      ex.cacheHit ? (
        <Badge variant="default" className="text-[10px]">
          Hit · {ex.cacheType === 'semantic' ? 'Semantic' : 'Prompt'}
        </Badge>
      ) : (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          Miss
        </Badge>
      ),
  },
  {
    id: 'webhook',
    label: 'Webhook',
    headerClassName: 'py-2 pr-4',
    cellClassName: 'py-2 pr-4 text-xs',
    renderCell: (ex: ExecutionRow) => ex.webhookStatus ?? '—',
  },
  {
    id: 'when',
    label: 'When',
    headerClassName: 'py-2',
    cellClassName: 'py-2 text-xs text-muted-foreground',
    renderCell: (ex: ExecutionRow) => formatDate(ex.createdAt),
  },
] as const;

type ColumnId = (typeof COLUMN_DEFS)[number]['id'];

const ALL_COLUMN_IDS = COLUMN_DEFS.map((c) => c.id) as ColumnId[];

const COLUMNS_STORAGE_KEY = 'inferences-columns';

function useVisibleColumns() {
  const [visibleIds, setVisibleIds] = useState<Set<ColumnId>>(new Set(ALL_COLUMN_IDS));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter((id): id is ColumnId => ALL_COLUMN_IDS.includes(id));
        if (filtered.length > 0) setVisibleIds(new Set(filtered));
      }
    } catch {
      // malformed or stale localStorage — keep the "all visible" default
    }
    setHydrated(true);
  }, []);

  // Persisted from an effect, not from inside the state updater: updaters must be
  // pure, and React invokes them twice under StrictMode. Gated on `hydrated` so the
  // default never overwrites a stored value before it has been read.
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(Array.from(visibleIds)));
  }, [visibleIds, hydrated]);

  const toggleColumn = useCallback((id: ColumnId) => {
    setVisibleIds((prev) => {
      if (prev.has(id) && prev.size === 1) return prev;
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return { visibleIds, toggleColumn };
}

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
      if (applied.cacheType !== 'all') params.append('cacheType', applied.cacheType);
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

  const { visibleIds, toggleColumn } = useVisibleColumns();
  const visibleColumns = COLUMN_DEFS.filter((col) => visibleIds.has(col.id));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Inferences</h2>
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
              <Select value={filters.cacheType} onValueChange={(v) => setFilters((f) => ({ ...f, cacheType: v }))}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="exact">Hit · Prompt</SelectItem>
                  <SelectItem value="semantic">Hit · Semantic</SelectItem>
                  <SelectItem value="miss">Miss</SelectItem>
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
          <div className="flex justify-end mb-3">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                <Settings2 className="h-4 w-4 mr-2" />
                Columns
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {COLUMN_DEFS.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    checked={visibleIds.has(col.id)}
                    disabled={visibleIds.size === 1 && visibleIds.has(col.id)}
                    onCheckedChange={() => toggleColumn(col.id)}
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
                    {visibleColumns.map((col) => (
                      <th key={col.id} className={`${col.headerClassName} last:pr-0`}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {executions.map((ex) => (
                    <tr
                      key={ex.id}
                      className="border-b last:border-b-0 cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => router.push(`/inferences/${ex.id}`)}
                    >
                      {visibleColumns.map((col) => (
                        <td key={col.id} className={`${col.cellClassName} last:pr-0`}>
                          {col.renderCell(ex)}
                        </td>
                      ))}
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

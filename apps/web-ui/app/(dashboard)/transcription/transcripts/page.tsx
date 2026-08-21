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
import { ChevronLeft, ChevronRight, Search, AudioLines, CheckCircle2, Clock, Timer } from 'lucide-react';

interface JobRow {
  id: string;
  source: string;
  status: string;
  fileName: string | null;
  mimeType: string | null;
  durationSec: number | null;
  latencyMs: number | null;
  language: string | null;
  webhookStatus: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface Stats {
  total: number;
  successRate: number;
  avgLatencyMs: number | null;
  totalMinutes: number;
}

interface Filters {
  search: string;
  status: string;
  source: string;
  fromDate: string;
  toDate: string;
  page: number;
}

const DEFAULT_FILTERS: Filters = { search: '', status: 'all', source: 'all', fromDate: '', toDate: '', page: 1 };

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

export default function TranscriptionTranscriptsPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<Filters>(DEFAULT_FILTERS);

  const { data, isLoading } = useQuery({
    queryKey: ['transcription-jobs', applied],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (applied.status !== 'all') params.append('status', applied.status);
      if (applied.source !== 'all') params.append('source', applied.source);
      if (applied.fromDate) params.append('fromDate', applied.fromDate);
      if (applied.toDate) params.append('toDate', applied.toDate);
      if (applied.search) params.append('search', applied.search);
      params.append('page', String(applied.page));
      params.append('limit', '20');
      const res = await fetch(`/api/transcription/jobs?${params}`);
      if (!res.ok) throw new Error('Failed to fetch jobs');
      return res.json() as Promise<{
        stats: Stats;
        jobs: JobRow[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>;
    },
    staleTime: 1000 * 30,
  });

  const handleApply = () => setApplied({ ...filters, page: 1 });
  const handleClear = () => { setFilters(DEFAULT_FILTERS); setApplied(DEFAULT_FILTERS); };
  const setPage = (p: number) => { const u = { ...applied, page: p }; setFilters(u); setApplied(u); };

  const jobs = data?.jobs ?? [];
  const stats = data?.stats;
  const pagination = data?.pagination ?? { page: 1, totalPages: 1, total: 0, limit: 20 };

  const formatLatency = (ms: number | null) => {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };
  const formatDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  const statusVariant = (s: string): 'default' | 'secondary' | 'destructive' => {
    if (s === 'completed') return 'default';
    if (s === 'failed') return 'destructive';
    return 'secondary';
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AudioLines className="h-6 w-6" />
          <h2 className="text-3xl font-bold tracking-tight">Transcripts</h2>
        </div>
        <span className="text-sm text-muted-foreground">Speech-to-text jobs across all API keys</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {isLoading || !stats ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-6 pb-4"><Skeleton className="h-10 w-full" /></CardContent></Card>
          ))
        ) : (
          <>
            <StatCard label="Total Jobs" value={stats.total.toLocaleString()} icon={<AudioLines className="h-4 w-4" />} />
            <StatCard label="Success Rate" value={`${(stats.successRate * 100).toFixed(1)}%`} icon={<CheckCircle2 className="h-4 w-4" />} />
            <StatCard label="Avg Latency" value={formatLatency(stats.avgLatencyMs)} icon={<Clock className="h-4 w-4" />} />
            <StatCard label="Audio Minutes" value={stats.totalMinutes.toFixed(1)} icon={<Timer className="h-4 w-4" />} />
          </>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs font-medium text-muted-foreground">Search by ID</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Job ID..." value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} className="pl-9" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input type="date" value={filters.fromDate} onChange={(e) => setFilters((f) => ({ ...f, fromDate: e.target.value }))} className="w-36" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input type="date" value={filters.toDate} onChange={(e) => setFilters((f) => ({ ...f, toDate: e.target.value }))} className="w-36" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Source</label>
              <Select value={filters.source} onValueChange={(v) => setFilters((f) => ({ ...f, source: v }))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="payload">Payload</SelectItem>
                  <SelectItem value="s3">S3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleApply} size="sm">Apply</Button>
            <Button onClick={handleClear} variant="outline" size="sm">Clear</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : jobs.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No transcription runs yet. Create a Job and use its <strong>Playground</strong> to run a test, or call <code className="text-xs bg-muted px-1 rounded">POST /api/v1/transcription</code> with a job-scoped API key.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-4">ID</th>
                    <th className="py-2 pr-4">Source</th>
                    <th className="py-2 pr-4">File</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Duration</th>
                    <th className="py-2 pr-4">Latency</th>
                    <th className="py-2 pr-4">Lang</th>
                    <th className="py-2 pr-4">Webhook</th>
                    <th className="py-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-b last:border-b-0 cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => router.push(`/transcription/transcripts/${j.id}`)}>
                      <td className="py-2 pr-4 font-mono text-xs">{j.id.slice(0, 12)}…</td>
                      <td className="py-2 pr-4"><Badge variant="secondary" className="text-[10px] uppercase">{j.source}</Badge></td>
                      <td className="py-2 pr-4 max-w-[160px] truncate">{j.fileName ?? '—'}</td>
                      <td className="py-2 pr-4"><Badge variant={statusVariant(j.status)} className="text-[10px]">{j.status}</Badge></td>
                      <td className="py-2 pr-4">{j.durationSec ? `${j.durationSec.toFixed(1)}s` : '—'}</td>
                      <td className="py-2 pr-4">{formatLatency(j.latencyMs)}</td>
                      <td className="py-2 pr-4">{j.language ?? '—'}</td>
                      <td className="py-2 pr-4 text-xs">{j.webhookStatus ?? '—'}</td>
                      <td className="py-2 text-xs text-muted-foreground">{formatDate(j.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPage(pagination.page - 1)}><ChevronLeft className="h-4 w-4" /> Prev</Button>
            <Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage(pagination.page + 1)}>Next <ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

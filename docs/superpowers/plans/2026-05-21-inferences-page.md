# Inferences Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified `/inferences` page under Analytics that shows every `ApiKeyExecution` row (stateful and stateless) with a stats strip, filterable table, and per-execution detail page.

**Architecture:** Two new Next.js API routes (`GET /api/inferences` and `GET /api/inferences/[id]`) query `ApiKeyExecution` joined with `Agent`, `AgentVersion`, and optionally `InferenceSession`. Two new dashboard pages mirror the existing `/sessions` pattern. The sidebar `analyticsNav` gains one entry.

**Tech Stack:** Next.js 15 App Router, Prisma, @tanstack/react-query, shadcn/ui, Zod, Pino, TypeScript strict.

---

## File Map

| File | Action |
|---|---|
| `apps/web-ui/app/api/inferences/route.ts` | Create — list + stats endpoint |
| `apps/web-ui/app/api/inferences/[id]/route.ts` | Create — detail endpoint |
| `apps/web-ui/app/(dashboard)/inferences/page.tsx` | Create — list page |
| `apps/web-ui/app/(dashboard)/inferences/[id]/page.tsx` | Create — detail page |
| `apps/web-ui/components/layout/app-sidebar.tsx` | Modify — add nav entry + active path |
| `tests/e2e/inference-api.spec.ts` | Modify — add auth tests for new routes |

---

## Task 1: `GET /api/inferences` — list + stats endpoint

**Files:**
- Create: `apps/web-ui/app/api/inferences/route.ts`
- Modify: `tests/e2e/inference-api.spec.ts`

- [ ] **Step 1: Write the failing e2e auth test**

Add to `tests/e2e/inference-api.spec.ts` inside a new `test.describe('Inferences Dashboard API')` block:

```typescript
test.describe('Inferences Dashboard API', () => {
  test('GET /api/inferences rejects unauthenticated', async ({ request }) => {
    const response = await request.get('/api/inferences');
    expect(response.status()).toBeOneOf([401, 403]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (404 before route exists)**

```bash
bunx playwright test tests/e2e/inference-api.spec.ts --grep "GET /api/inferences rejects" 2>&1 | tail -20
```

Expected: test fails because route doesn't exist yet (404, not 401/403).

- [ ] **Step 3: Create the route file**

Create `apps/web-ui/app/api/inferences/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const logger = createLogger('api:inferences');

const querySchema = z.object({
  agentId: z.string().optional(),
  status: z.enum(['completed', 'failed', 'running']).optional(),
  type: z.enum(['stateful', 'stateless']).optional(),
  cacheHit: z.enum(['true', 'false']).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'InferenceSession', authOptions);
    if (authError) return authError;

    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid query params', details: parsed.error.flatten() }, { status: 400 });
    }

    const { agentId, status, type, cacheHit, fromDate, toDate, search, page, limit } = parsed.data;

    const where: Record<string, unknown> = { tenantId };

    if (agentId) where.agentId = agentId;
    if (status) where.status = status;
    if (type === 'stateful') where.sessionId = { not: null };
    if (type === 'stateless') where.sessionId = null;
    if (cacheHit === 'true') where.cacheHit = true;
    if (cacheHit === 'false') where.cacheHit = false;
    if (fromDate || toDate) {
      const range: Record<string, Date> = {};
      if (fromDate) range.gte = new Date(fromDate);
      if (toDate) range.lte = new Date(`${toDate}T23:59:59.999Z`);
      where.createdAt = range;
    }
    if (search) {
      where.id = { contains: search, mode: 'insensitive' };
    }

    const prisma = getPrismaClient();

    const [rows, total, statsAgg] = await Promise.all([
      prisma.apiKeyExecution.findMany({
        where,
        include: {
          agent: { select: { id: true, name: true, type: true } },
          agentVersion: { select: { id: true, version: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.apiKeyExecution.count({ where }),
      prisma.apiKeyExecution.aggregate({
        where,
        _count: { id: true },
        _avg: { latencyMs: true },
      }),
    ]);

    const allInWindow = await prisma.apiKeyExecution.findMany({
      where,
      select: { status: true, cacheHit: true },
    });

    const completedCount = allInWindow.filter((r) => r.status === 'completed').length;
    const cacheHitCount = allInWindow.filter((r) => r.cacheHit).length;
    const windowTotal = allInWindow.length;

    const stats = {
      total: windowTotal,
      successRate: windowTotal > 0 ? completedCount / windowTotal : 0,
      avgLatencyMs: statsAgg._avg.latencyMs ?? null,
      cacheHitRate: windowTotal > 0 ? cacheHitCount / windowTotal : 0,
    };

    const executions = rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      agentVersionId: r.agentVersionId,
      sessionId: r.sessionId,
      status: r.status,
      latencyMs: r.latencyMs,
      tokenUsage: r.tokenUsage,
      cacheHit: r.cacheHit,
      webhookStatus: r.webhookStatus,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      agent: r.agent,
      agentVersion: r.agentVersion,
    }));

    logger.info({ tenantId, total, page }, 'Inferences list fetched');

    return NextResponse.json({
      stats,
      executions,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ err: error }, 'Inferences list error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the auth test — should pass now**

```bash
bunx playwright test tests/e2e/inference-api.spec.ts --grep "GET /api/inferences rejects" 2>&1 | tail -10
```

Expected: PASS (unauthenticated request returns 401).

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/app/api/inferences/route.ts tests/e2e/inference-api.spec.ts
git commit -m "feat(inferences): add GET /api/inferences list + stats endpoint"
```

---

## Task 2: `GET /api/inferences/[id]` — detail endpoint

**Files:**
- Create: `apps/web-ui/app/api/inferences/[id]/route.ts`
- Modify: `tests/e2e/inference-api.spec.ts`

- [ ] **Step 1: Write the failing e2e auth test**

Add inside the existing `test.describe('Inferences Dashboard API')` block in `tests/e2e/inference-api.spec.ts`:

```typescript
  test('GET /api/inferences/[id] rejects unauthenticated', async ({ request }) => {
    const response = await request.get('/api/inferences/some-id');
    expect(response.status()).toBeOneOf([401, 403]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bunx playwright test tests/e2e/inference-api.spec.ts --grep "GET /api/inferences/\[id\] rejects" 2>&1 | tail -10
```

Expected: FAIL (404 — route doesn't exist yet).

- [ ] **Step 3: Create the detail route**

Create `apps/web-ui/app/api/inferences/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const logger = createLogger('api:inferences:detail');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'InferenceSession', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const prisma = getPrismaClient();

    const execution = await prisma.apiKeyExecution.findFirst({
      where: { id, tenantId },
      include: {
        agent: { select: { id: true, name: true, type: true } },
        agentVersion: { select: { id: true, version: true, status: true } },
        session: {
          select: {
            id: true,
            status: true,
            channel: true,
            channelMetadata: true,
          },
        },
      },
    });

    if (!execution) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    logger.info({ tenantId, executionId: id }, 'Inference detail fetched');

    return NextResponse.json({
      execution: {
        id: execution.id,
        agentId: execution.agentId,
        agentVersionId: execution.agentVersionId,
        sessionId: execution.sessionId,
        status: execution.status,
        input: execution.input,
        output: execution.output,
        error: execution.error,
        tokenUsage: execution.tokenUsage,
        cacheHit: execution.cacheHit,
        latencyMs: execution.latencyMs,
        webhookUrl: execution.webhookUrl,
        webhookStatus: execution.webhookStatus,
        webhookDeliveredAt: execution.webhookDeliveredAt,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        createdAt: execution.createdAt,
      },
      agent: execution.agent,
      agentVersion: execution.agentVersion,
      session: execution.session ?? null,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    logger.error({ err: error }, 'Inference detail error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the auth test — should pass**

```bash
bunx playwright test tests/e2e/inference-api.spec.ts --grep "Inferences Dashboard API" 2>&1 | tail -10
```

Expected: both auth tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/app/api/inferences/[id]/route.ts tests/e2e/inference-api.spec.ts
git commit -m "feat(inferences): add GET /api/inferences/[id] detail endpoint"
```

---

## Task 3: `/inferences` — list page

**Files:**
- Create: `apps/web-ui/app/(dashboard)/inferences/page.tsx`

- [ ] **Step 1: Create the list page**

Create `apps/web-ui/app/(dashboard)/inferences/page.tsx`:

```typescript
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
  const handleClear = () => { setFilters(DEFAULT_FILTERS); setApplied(DEFAULT_FILTERS); };
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
            <Card key={i}><CardContent className="pt-6 pb-4"><Skeleton className="h-10 w-full" /></CardContent></Card>
          ))
        ) : (
          <>
            <StatCard label="Total Inferences" value={stats.total.toLocaleString()} icon={<Zap className="h-4 w-4" />} />
            <StatCard label="Success Rate" value={`${(stats.successRate * 100).toFixed(1)}%`} icon={<CheckCircle2 className="h-4 w-4" />} />
            <StatCard label="Avg Latency" value={formatLatency(stats.avgLatencyMs)} icon={<Clock className="h-4 w-4" />} />
            <StatCard label="Cache Hit Rate" value={`${(stats.cacheHitRate * 100).toFixed(1)}%`} icon={<Database className="h-4 w-4" />} />
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
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <Select value={filters.type} onValueChange={(v) => setFilters((f) => ({ ...f, type: v }))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
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
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
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
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : executions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No inferences found. Calls to <code className="text-xs bg-muted px-1 rounded">POST /api/v1/inference</code> appear here.
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
                        {ex.agentVersion ? <span className="text-muted-foreground ml-1 text-xs">v{ex.agentVersion.version}</span> : null}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={ex.sessionId ? 'default' : 'secondary'} className="text-[10px]">
                          {ex.sessionId ? 'Stateful' : 'Stateless'}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={statusVariant(ex.status)} className="text-[10px]">{ex.status}</Badge>
                      </td>
                      <td className="py-2 pr-4">{formatLatency(ex.latencyMs)}</td>
                      <td className="py-2 pr-4">{ex.tokenUsage && typeof ex.tokenUsage === 'object' && 'totalTokens' in ex.tokenUsage ? (ex.tokenUsage as { totalTokens: number }).totalTokens : '—'}</td>
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
            <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPage(pagination.page - 1)}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage(pagination.page + 1)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web-ui && bunx tsc --noEmit 2>&1 | grep -E "inferences" | head -20
```

Expected: no errors for the new file.

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/app/\(dashboard\)/inferences/page.tsx
git commit -m "feat(inferences): add /inferences list page with stats strip and filterable table"
```

---

## Task 4: `/inferences/[id]` — detail page

**Files:**
- Create: `apps/web-ui/app/(dashboard)/inferences/[id]/page.tsx`

- [ ] **Step 1: Create the detail page**

Create `apps/web-ui/app/(dashboard)/inferences/[id]/page.tsx`:

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { ChevronLeft, Copy, ExternalLink } from 'lucide-react';

interface InferenceDetail {
  execution: {
    id: string;
    agentId: string;
    agentVersionId: string | null;
    sessionId: string | null;
    status: string;
    input: {
      messages?: Array<{ role: string; content?: string }>;
      systemPrompt?: string;
    } | null;
    output: { text?: string } | null;
    error: string | null;
    tokenUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
    cacheHit: boolean;
    latencyMs: number | null;
    webhookUrl: string | null;
    webhookStatus: string | null;
    webhookDeliveredAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
  };
  agent: { id: string; name: string; type: string } | null;
  agentVersion: { id: string; version: number; status: string } | null;
  session: { id: string; status: string; channel: string; channelMetadata: unknown } | null;
}

export default function InferenceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const { data, isLoading, error } = useQuery({
    queryKey: ['inference-detail', id],
    queryFn: async (): Promise<InferenceDetail> => {
      const res = await fetch(`/api/inferences/${id}`);
      if (!res.ok) throw new Error('Failed to load inference');
      return res.json();
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => router.push('/inferences')}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Card className="mt-4">
          <CardContent className="py-12 text-center text-muted-foreground">
            Inference execution not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { execution: ex, agent, agentVersion, session } = data;

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  const formatLatency = (ms: number | null) => {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  const isStateful = !!ex.sessionId;
  const statusVariant = ex.status === 'completed' ? 'default' : ex.status === 'failed' ? 'destructive' : 'secondary';
  const inputMessages = ex.input?.messages ?? [];
  const systemPrompt = ex.input?.systemPrompt;
  const outputText = ex.output?.text ?? null;

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => router.push('/inferences')}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-lg font-semibold tracking-tight font-mono">{ex.id}</h1>
        <Badge variant={statusVariant}>{ex.status}</Badge>
        <Badge variant={isStateful ? 'default' : 'secondary'}>{isStateful ? 'Stateful' : 'Stateless'}</Badge>
      </div>

      {/* Execution summary */}
      <Card>
        <CardHeader><CardTitle className="text-base">Execution</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground text-xs">Agent</div>
            <div>{agent?.name ?? '—'}{agent ? ` · ${agent.type}` : ''}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Version</div>
            <div>{agentVersion ? `v${agentVersion.version} (${agentVersion.status})` : '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Cache</div>
            <div>{ex.cacheHit ? 'Hit' : 'Miss'}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Started</div>
            <div>{formatDate(ex.startedAt ?? ex.createdAt)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Completed</div>
            <div>{formatDate(ex.completedAt)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Latency</div>
            <div>{formatLatency(ex.latencyMs)}</div>
          </div>
          {ex.tokenUsage && (
            <>
              <div>
                <div className="text-muted-foreground text-xs">Input tokens</div>
                <div>{ex.tokenUsage.inputTokens ?? '—'}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Output tokens</div>
                <div>{ex.tokenUsage.outputTokens ?? '—'}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Total tokens</div>
                <div>{ex.tokenUsage.totalTokens ?? '—'}</div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Session card — stateful only */}
      {isStateful && session && (
        <Card>
          <CardHeader><CardTitle className="text-base">Session</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{session.id}</span>
              <Badge variant={session.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
                {session.status}
              </Badge>
              <Badge variant="outline" className="text-[10px]">{session.channel}</Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => router.push(`/sessions/${session.id}`)}
              >
                View session <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </div>
            {session.channelMetadata && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Channel metadata</summary>
                <pre className="mt-2 bg-muted/40 rounded p-2 overflow-auto max-h-32">
                  {JSON.stringify(session.channelMetadata, null, 2)}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* Input / Output */}
      <Card>
        <CardHeader><CardTitle className="text-base">Input / Output</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Input */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Input</div>
              {systemPrompt && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">System prompt</summary>
                  <pre className="mt-1 bg-muted/40 rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap">{systemPrompt}</pre>
                </details>
              )}
              <div className="space-y-2">
                {inputMessages.map((m, i) => (
                  <div
                    key={i}
                    className={`rounded p-2 text-sm ${
                      m.role === 'user'
                        ? 'bg-primary/10 ml-8'
                        : 'bg-muted/40 mr-8'
                    }`}
                  >
                    <div className="text-[10px] text-muted-foreground mb-1 capitalize">{m.role}</div>
                    <div className="whitespace-pre-wrap">{m.content ?? ''}</div>
                  </div>
                ))}
                {inputMessages.length === 0 && (
                  <p className="text-xs text-muted-foreground">No messages in input.</p>
                )}
              </div>
            </div>

            {/* Output */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">Output</div>
                {outputText && (
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => copyToClipboard(outputText)}>
                    <Copy className="h-3 w-3 mr-1" /> Copy
                  </Button>
                )}
              </div>
              {outputText ? (
                <div className="bg-muted/40 rounded p-3 text-sm whitespace-pre-wrap max-h-96 overflow-auto">
                  {outputText}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No output recorded.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Webhook card */}
      {ex.webhookUrl && (
        <Card>
          <CardHeader><CardTitle className="text-base">Webhook</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs truncate max-w-xs">{ex.webhookUrl}</span>
              {ex.webhookStatus && (
                <Badge
                  variant={ex.webhookStatus === 'delivered' ? 'default' : 'destructive'}
                  className="text-[10px]"
                >
                  {ex.webhookStatus}
                </Badge>
              )}
              {ex.webhookDeliveredAt && (
                <span className="text-xs text-muted-foreground">{formatDate(ex.webhookDeliveredAt)}</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error card */}
      {ex.status === 'failed' && ex.error && (
        <Card className="border-destructive/50">
          <CardHeader><CardTitle className="text-base text-destructive">Error</CardTitle></CardHeader>
          <CardContent>
            <pre className="bg-destructive/10 border border-destructive/20 rounded p-3 text-xs text-destructive overflow-auto whitespace-pre-wrap">
              {ex.error}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web-ui && bunx tsc --noEmit 2>&1 | grep -E "inferences" | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/web-ui/app/(dashboard)/inferences/[id]/page.tsx"
git commit -m "feat(inferences): add /inferences/[id] detail page"
```

---

## Task 5: Sidebar navigation

**Files:**
- Modify: `apps/web-ui/components/layout/app-sidebar.tsx`

- [ ] **Step 1: Add `Zap` to the lucide import and add the nav entry**

In `apps/web-ui/components/layout/app-sidebar.tsx`, update the lucide import to include `Zap`:

```typescript
import {
  LayoutDashboard,
  MessageSquare,
  History,
  Settings,
  Activity,
  Users,
  Shield,
  LogOut,
  User,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  Bot,
  Database,
  Plus,
  FolderOpen,
  Server,
  Sparkles,
  BarChart3,
  Zap,
} from 'lucide-react';
```

Update `analyticsNav` to add the Inferences entry:

```typescript
const analyticsNav = [
  { name: 'Dashboard', href: '/analytics', icon: BarChart3 },
  { name: 'Sessions', href: '/sessions', icon: History },
  { name: 'Inferences', href: '/inferences', icon: Zap },
];
```

Update `isAnalyticsActive` to include the `/inferences` path:

```typescript
const isAnalyticsActive =
  pathname === '/analytics' ||
  pathname.startsWith('/analytics/') ||
  pathname === '/sessions' ||
  pathname.startsWith('/sessions/') ||
  pathname === '/inferences' ||
  pathname.startsWith('/inferences/');
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web-ui && bunx tsc --noEmit 2>&1 | grep -E "sidebar|Zap" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web-ui/components/layout/app-sidebar.tsx
git commit -m "feat(inferences): add Inferences nav item under Analytics in sidebar"
```

---

## Task 6: End-to-end navigation smoke test

**Files:**
- Modify: `tests/e2e/navigation.spec.ts`

- [ ] **Step 1: Add navigation test for /inferences**

Add to `tests/e2e/navigation.spec.ts`:

```typescript
test('unauthenticated user is redirected from /inferences to /login', async ({ page }) => {
  await page.goto('/inferences');
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 2: Run the navigation test**

```bash
bunx playwright test tests/e2e/navigation.spec.ts 2>&1 | tail -20
```

Expected: all navigation tests pass including the new one.

- [ ] **Step 3: Run the full e2e suite to check for regressions**

```bash
bun run e2e 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/navigation.spec.ts
git commit -m "test(inferences): add navigation smoke test for /inferences route"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Stats strip (total, success rate, avg latency, cache hit rate) — Task 3
- [x] Filterable table (search, agent, status, type, cache, date range) — Task 3
- [x] One row per ApiKeyExecution, stateful/stateless badge — Task 3
- [x] Click row → `/inferences/[id]` — Task 3
- [x] Detail page: header, summary card, session card (stateful only), input/output, webhook, error — Task 4
- [x] `GET /api/inferences` with Zod validation, Pino logging, RBAC — Task 1
- [x] `GET /api/inferences/[id]` with Zod validation, Pino logging, RBAC — Task 2
- [x] Sidebar nav entry under Analytics — Task 5
- [x] Auth e2e tests for both new API routes — Tasks 1 & 2
- [x] Navigation smoke test — Task 6

**Placeholder scan:** No TBDs, TODOs, or vague steps found.

**Type consistency:** `ExecutionRow` in list page matches response shape from `GET /api/inferences`. `InferenceDetail` in detail page matches response shape from `GET /api/inferences/[id]`. `session` relation on `ApiKeyExecution` is confirmed in Prisma schema (line 481).


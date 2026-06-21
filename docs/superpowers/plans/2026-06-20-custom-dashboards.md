# Custom Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let tenant members build org-shared dashboards by composing chart widgets from a guided metric builder (data source + metric + dimension + filters + date range + viz type) on a drag-and-drop grid.

**Architecture:** A server-side **Source Registry** is the single security boundary — users compose a constrained `WidgetQuerySpec` (JSON), validated by a registry-derived Zod schema, executed by a tenant-scoped query service. Two new Prisma models (`Dashboard`, `DashboardWidget`) persist dashboards. A stateless `POST /api/dashboards/query` endpoint serves both the builder's live preview and saved-widget rendering. Frontend uses react-grid-layout + the existing recharts/shadcn chart wrappers.

**Tech Stack:** Next.js 15 (App Router), TypeScript strict, Prisma + Postgres, Zod, @tanstack/react-query v5, recharts 3, shadcn/ui, react-grid-layout (new), Vitest, Playwright.

## Global Constraints

- TypeScript strict mode, ES2022. No implicit `any`, all params typed.
- **Zod** at every API boundary; the builder reuses the same schema client-side.
- **Never access `process.env` directly** — use the T3 env object.
- **shadcn/ui only** — no raw HTML form elements (`<select>`, `<input>` outside shadcn).
- **try/catch + Pino** in every handler and service method. Logger via `createLogger('<scope>')` from `@chatbot/shared`. Structured context: `{ tenantId, userId, dashboardId, widgetId }`. Never swallow errors.
- Multi-tenancy: every query scopes by `tenantId` from `getSessionTenantId(authOptions)`; `authorize(action, 'Dashboard', authOptions)` guards every handler.
- Prisma conventions: `@@map` snake_case tables, camelCase fields, `@@index([tenantId])`, cascade deletes.
- Services live in `libs/shared/src/services/`, class-based with an injected Prisma-shaped `db` dependency, exported from `libs/shared/src/index.ts`.
- Commit after every task. Commit message footer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Reference Patterns (verbatim from codebase)

- API route: `apps/web-ui/app/api/v1/scores/route.ts` — imports `getPrismaClient, ServiceX, createLogger, <schema>, ValidationError` from `@chatbot/shared`; `const logger = createLogger('api:...')`; Zod `safeParse` → 422 `{ error: { type: 'validation_error', issues } }`; `logger.error({ err }, 'msg')`.
- Session-based route guard: `apps/web-ui/app/api/analytics/summary/route.ts` — `const tenantId = await getSessionTenantId(authOptions); const authError = await authorize('read','InferenceSession',authOptions); if (authError) return authError;` with `import { authOptions } from '@/lib/auth'` and `export const dynamic = 'force-dynamic'`.
- Service: `libs/shared/src/services/score-service.ts` — `export class ScoreService { constructor(private readonly db: ScoreDb) {} }`, `where: Record<string, unknown> = { tenantId }`.
- RBAC: `libs/shared/src/rbac/types.ts` (`Module` union, `SUBJECT_TO_MODULE`), `permissions.ts` (`ROLE_PERMISSIONS`, `getAutoLevel` `maxPossible`), `authorize.ts`.
- Zod schemas: `libs/shared/src/validation/schemas/*.ts`, barrel `libs/shared/src/validation/index.ts` → `export * from './schemas'`.
- Charts: `apps/web-ui/components/ui/chart.tsx` (`ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartConfig`), example `apps/web-ui/components/dashboard/activity-chart.tsx`.
- React Query: `apps/web-ui/app/(dashboard)/analytics/page.tsx` (`useQuery({ queryKey, queryFn, staleTime })`); provider at `apps/web-ui/app/providers.tsx`.
- Vitest: `libs/shared/src/rbac/authorize.test.ts` (`vi.mock`, `describe/it/expect`).
- E2e: `apps/web-ui-e2e/src/modules/inference-api/inference-api.spec.ts`, tags `apps/web-ui-e2e/src/constants/tags.ts`; specs import `{ test, expect }` from `../../fixtures/base`.

---

## Task 1: Source Registry + WidgetQuerySpec schema

The security core. Pure TypeScript + Zod, no DB. Defines the allowed vocabulary and a registry-derived validator that rejects anything unknown.

**Files:**
- Create: `libs/shared/src/dashboards/source-registry.ts`
- Create: `libs/shared/src/dashboards/widget-query-spec.ts`
- Create: `libs/shared/src/dashboards/index.ts`
- Test: `libs/shared/src/dashboards/widget-query-spec.test.ts`
- Modify: `libs/shared/src/index.ts` (add export)

**Interfaces:**
- Produces:
  - `VizType = 'line' | 'area' | 'bar' | 'pie' | 'kpi'`
  - `AggFn = 'count' | 'avg' | 'sum'`
  - `TimeBucket = 'day' | 'week' | 'month'`
  - `interface SourceDef { key; label; model: 'inferenceSession' | 'sessionAnalytics'; table: string; timeColumn: string; metrics: MetricDef[]; dimensions: DimensionDef[]; filters: FilterDef[] }`
  - `interface MetricDef { key: string; label: string; agg: AggFn; column: string | null; validViz: VizType[] }`
  - `interface DimensionDef { key: string; label: string; column: string }`
  - `interface FilterDef { key: string; label: string; column: string; ops: ('eq'|'in')[]; enumValues?: string[] }`
  - `SOURCE_REGISTRY: Record<string, SourceDef>`
  - `getRegistryMeta(): SourceMeta[]` — UI-safe view (no column names)
  - `widgetQuerySpecSchema` (Zod), `type WidgetQuerySpec = z.infer<typeof widgetQuerySpecSchema>`
  - `resolveSpec(spec: WidgetQuerySpec): ResolvedSpec` — throws `ValidationError` if any key not in registry; returns real columns. `ResolvedSpec = { source: SourceDef; metric: MetricDef; dimension: DimensionDef | null; timeBucket: TimeBucket | null; filters: { column: string; op: 'eq'|'in'; value: unknown }[]; range: { from: Date; to: Date }; vizType: VizType }`

- [ ] **Step 1: Write the failing test**

Create `libs/shared/src/dashboards/widget-query-spec.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { widgetQuerySpecSchema, resolveSpec } from './widget-query-spec';
import { ValidationError } from '../errors';

const base = {
  source: 'sessions',
  metric: { key: 'count' },
  dateRange: { preset: 'last_30d' as const },
  filters: [],
  vizType: 'bar' as const,
  dimension: 'channel',
};

describe('widgetQuerySpecSchema', () => {
  it('accepts a valid spec', () => {
    expect(widgetQuerySpecSchema.safeParse(base).success).toBe(true);
  });

  it('rejects an unknown viz type at the schema level', () => {
    const r = widgetQuerySpecSchema.safeParse({ ...base, vizType: 'radar' });
    expect(r.success).toBe(false);
  });
});

describe('resolveSpec', () => {
  it('resolves a known dimension to its real column', () => {
    const resolved = resolveSpec(widgetQuerySpecSchema.parse(base));
    expect(resolved.source.table).toBe('inference_sessions');
    expect(resolved.dimension?.column).toBe('channel');
    expect(resolved.range.from).toBeInstanceOf(Date);
  });

  it('throws ValidationError for an unknown source', () => {
    expect(() => resolveSpec({ ...base, source: 'secrets' } as never)).toThrow(ValidationError);
  });

  it('throws ValidationError for a dimension not in the source registry', () => {
    expect(() => resolveSpec({ ...base, dimension: 'password' } as never)).toThrow(ValidationError);
  });

  it('throws ValidationError for an unknown metric key', () => {
    expect(() => resolveSpec({ ...base, metric: { key: 'drop_table' } } as never)).toThrow(ValidationError);
  });

  it('resolves an avg metric to its real column', () => {
    const resolved = resolveSpec(
      widgetQuerySpecSchema.parse({ ...base, source: 'session_analytics', metric: { key: 'avg_confidence' }, dimension: undefined, vizType: 'kpi' }),
    );
    expect(resolved.metric.agg).toBe('avg');
    expect(resolved.metric.column).toBe('confidenceScore');
  });
});
```

- [ ] **Step 2: Confirm the shared error type exists**

Run: `grep -rn "class ValidationError" libs/shared/src --include="*.ts" | grep -v ".d.ts"`
Expected: a `ValidationError` class (it is exported from `@chatbot/shared`, used in `scores/route.ts`). Note its import path (e.g. `../errors`). If the relative path differs, adjust the test import and Step 4 import accordingly. `ValidationError` carries an `issues` array.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd libs/shared && bunx vitest run src/dashboards/widget-query-spec.test.ts`
Expected: FAIL — module `./widget-query-spec` not found.

- [ ] **Step 4: Create the registry**

Create `libs/shared/src/dashboards/source-registry.ts`:

```ts
export type VizType = 'line' | 'area' | 'bar' | 'pie' | 'kpi';
export type AggFn = 'count' | 'avg' | 'sum';
export type TimeBucket = 'day' | 'week' | 'month';

export interface MetricDef {
  key: string;
  label: string;
  agg: AggFn;
  column: string | null; // null => COUNT(*)
  validViz: VizType[];
}

export interface DimensionDef {
  key: string;
  label: string;
  column: string;
}

export interface FilterDef {
  key: string;
  label: string;
  column: string;
  ops: ('eq' | 'in')[];
  enumValues?: string[];
}

export interface SourceDef {
  key: string;
  label: string;
  model: 'inferenceSession' | 'sessionAnalytics';
  table: string; // real DB table name (snake_case)
  timeColumn: string; // real DB column for time bucketing + date range
  metrics: MetricDef[];
  dimensions: DimensionDef[];
  filters: FilterDef[];
}

const ALL_VIZ: VizType[] = ['line', 'area', 'bar', 'pie', 'kpi'];

export const SOURCE_REGISTRY: Record<string, SourceDef> = {
  sessions: {
    key: 'sessions',
    label: 'Sessions & messages',
    model: 'inferenceSession',
    table: 'inference_sessions',
    timeColumn: 'createdAt',
    metrics: [{ key: 'count', label: 'Session count', agg: 'count', column: null, validViz: ALL_VIZ }],
    dimensions: [
      { key: 'channel', label: 'Channel', column: 'channel' },
      { key: 'status', label: 'Status', column: 'status' },
      { key: 'agentId', label: 'Agent', column: 'agentId' },
    ],
    filters: [
      { key: 'channel', label: 'Channel', column: 'channel', ops: ['eq', 'in'] },
      { key: 'status', label: 'Status', column: 'status', ops: ['eq', 'in'] },
    ],
  },
  session_analytics: {
    key: 'session_analytics',
    label: 'Session analytics',
    model: 'sessionAnalytics',
    table: 'session_analytics',
    timeColumn: 'analyzedAt',
    metrics: [
      { key: 'count', label: 'Analyzed sessions', agg: 'count', column: null, validViz: ALL_VIZ },
      { key: 'avg_confidence', label: 'Avg confidence', agg: 'avg', column: 'confidenceScore', validViz: ['line', 'area', 'bar', 'kpi'] },
      { key: 'avg_message_count', label: 'Avg messages / session', agg: 'avg', column: 'messageCount', validViz: ['line', 'area', 'bar', 'kpi'] },
    ],
    dimensions: [
      { key: 'sentiment', label: 'Sentiment', column: 'sentiment' },
      { key: 'isResolved', label: 'Resolved', column: 'isResolved' },
    ],
    filters: [
      { key: 'sentiment', label: 'Sentiment', column: 'sentiment', ops: ['eq', 'in'] },
      { key: 'isResolved', label: 'Resolved', column: 'isResolved', ops: ['eq'] },
    ],
  },
};

// UI-safe projection — never leak raw column names to the client.
export interface SourceMeta {
  key: string;
  label: string;
  metrics: { key: string; label: string; agg: AggFn; validViz: VizType[]; requiresField: boolean }[];
  dimensions: { key: string; label: string }[];
  filters: { key: string; label: string; ops: ('eq' | 'in')[]; enumValues?: string[] }[];
}

export function getRegistryMeta(): SourceMeta[] {
  return Object.values(SOURCE_REGISTRY).map((s) => ({
    key: s.key,
    label: s.label,
    metrics: s.metrics.map((m) => ({ key: m.key, label: m.label, agg: m.agg, validViz: m.validViz, requiresField: m.column !== null && m.agg !== 'count' })),
    dimensions: s.dimensions.map((d) => ({ key: d.key, label: d.label })),
    filters: s.filters.map((f) => ({ key: f.key, label: f.label, ops: f.ops, enumValues: f.enumValues })),
  }));
}
```

- [ ] **Step 5: Create the spec schema + resolver**

Create `libs/shared/src/dashboards/widget-query-spec.ts`:

```ts
import { z } from 'zod';
import { ValidationError } from '../errors';
import { SOURCE_REGISTRY, type SourceDef, type MetricDef, type DimensionDef, type VizType, type TimeBucket } from './source-registry';

const MAX_WINDOW_DAYS = 365;
const PRESET_DAYS: Record<string, number> = { last_7d: 7, last_30d: 30, last_90d: 90 };

export const widgetQuerySpecSchema = z.object({
  source: z.string().min(1),
  metric: z.object({ key: z.string().min(1) }),
  dimension: z.string().optional(),
  timeBucket: z.enum(['day', 'week', 'month']).optional(),
  filters: z
    .array(z.object({ field: z.string().min(1), op: z.enum(['eq', 'in']), value: z.union([z.string(), z.boolean(), z.array(z.string())]) }))
    .default([]),
  dateRange: z.union([
    z.object({ preset: z.enum(['last_7d', 'last_30d', 'last_90d']) }),
    z.object({ from: z.string().datetime(), to: z.string().datetime() }),
  ]),
  vizType: z.enum(['line', 'area', 'bar', 'pie', 'kpi']),
});

export type WidgetQuerySpec = z.infer<typeof widgetQuerySpecSchema>;

export interface ResolvedSpec {
  source: SourceDef;
  metric: MetricDef;
  dimension: DimensionDef | null;
  timeBucket: TimeBucket | null;
  filters: { column: string; op: 'eq' | 'in'; value: unknown }[];
  range: { from: Date; to: Date };
  vizType: VizType;
}

function resolveRange(dateRange: WidgetQuerySpec['dateRange']): { from: Date; to: Date } {
  if ('preset' in dateRange) {
    const days = PRESET_DAYS[dateRange.preset];
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return { from, to };
  }
  const from = new Date(dateRange.from);
  const to = new Date(dateRange.to);
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    throw new ValidationError('Date range exceeds the maximum allowed window', [{ path: ['dateRange'], message: 'range too large' }]);
  }
  return { from, to };
}

export function resolveSpec(specInput: WidgetQuerySpec): ResolvedSpec {
  const spec = widgetQuerySpecSchema.parse(specInput);
  const source = SOURCE_REGISTRY[spec.source];
  if (!source) throw new ValidationError('Unknown data source', [{ path: ['source'], message: spec.source }]);

  const metric = source.metrics.find((m) => m.key === spec.metric.key);
  if (!metric) throw new ValidationError('Unknown metric for this source', [{ path: ['metric'], message: spec.metric.key }]);
  if (metric.agg !== 'count' && !metric.column) {
    throw new ValidationError('Aggregation requires a field', [{ path: ['metric'], message: 'missing column' }]);
  }

  let dimension: DimensionDef | null = null;
  if (spec.dimension) {
    const d = source.dimensions.find((x) => x.key === spec.dimension);
    if (!d) throw new ValidationError('Unknown dimension for this source', [{ path: ['dimension'], message: spec.dimension }]);
    dimension = d;
  }

  if (!metric.validViz.includes(spec.vizType)) {
    throw new ValidationError('Visualization not valid for this metric', [{ path: ['vizType'], message: spec.vizType }]);
  }

  const filters = spec.filters.map((f) => {
    const def = source.filters.find((x) => x.key === f.field);
    if (!def) throw new ValidationError('Unknown filter field for this source', [{ path: ['filters'], message: f.field }]);
    if (!def.ops.includes(f.op)) throw new ValidationError('Unsupported filter operator', [{ path: ['filters'], message: f.op }]);
    return { column: def.column, op: f.op, value: f.value };
  });

  return { source, metric, dimension, timeBucket: spec.timeBucket ?? null, filters, range: resolveRange(spec.dateRange), vizType: spec.vizType };
}
```

- [ ] **Step 6: Create the dashboards barrel**

Create `libs/shared/src/dashboards/index.ts`:

```ts
export * from './source-registry';
export * from './widget-query-spec';
```

- [ ] **Step 7: Export from shared barrel**

In `libs/shared/src/index.ts`, add after the rbac exports (around line 24):

```ts
export * from './dashboards';
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd libs/shared && bunx vitest run src/dashboards/widget-query-spec.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add libs/shared/src/dashboards libs/shared/src/index.ts
git commit -m "feat(dashboards): source registry + widget query spec validator"
```

---

## Task 2: Dashboard query service

Translates a validated spec into a tenant-scoped aggregation. Three shapes: time-series (raw SQL `date_trunc`), grouped-by-dimension (Prisma `groupBy`), single value (Prisma `aggregate`/`count`).

**Files:**
- Create: `libs/shared/src/services/dashboard-query-service.ts`
- Test: `libs/shared/src/services/dashboard-query-service.test.ts`
- Modify: `libs/shared/src/index.ts`

**Interfaces:**
- Consumes: `resolveSpec`, `WidgetQuerySpec`, registry types (Task 1).
- Produces:
  - `type QueryResultRow = { label: string; value: number }`
  - `interface DashboardQueryDb { $queryRaw: (...args: unknown[]) => Promise<unknown>; inferenceSession: { groupBy: Function; count: Function; aggregate: Function }; sessionAnalytics: { groupBy: Function; count: Function; aggregate: Function } }`
  - `class DashboardQueryService { constructor(db: DashboardQueryDb); run(tenantId: string, spec: WidgetQuerySpec): Promise<QueryResultRow[]> }`
  - `TOP_N = 20` (dimension cap)

- [ ] **Step 1: Write the failing test**

Create `libs/shared/src/services/dashboard-query-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { DashboardQueryService, type DashboardQueryDb } from './dashboard-query-service';

function makeDb(overrides: Partial<Record<string, unknown>> = {}): DashboardQueryDb {
  return {
    $queryRaw: vi.fn(),
    inferenceSession: { groupBy: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
    sessionAnalytics: { groupBy: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
    ...overrides,
  } as unknown as DashboardQueryDb;
}

const KPI_SPEC = { source: 'sessions', metric: { key: 'count' }, dateRange: { preset: 'last_30d' as const }, filters: [], vizType: 'kpi' as const };

describe('DashboardQueryService', () => {
  it('kpi: returns a single count value scoped to tenant', async () => {
    const db = makeDb();
    (db.inferenceSession.count as ReturnType<typeof vi.fn>).mockResolvedValue(42);
    const rows = await new DashboardQueryService(db).run('t1', KPI_SPEC);
    expect(rows).toEqual([{ label: 'Session count', value: 42 }]);
    const callArg = (db.inferenceSession.count as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.where.tenantId).toBe('t1');
  });

  it('dimension: maps groupBy rows to {label,value}', async () => {
    const db = makeDb();
    (db.inferenceSession.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { channel: 'API', _count: { _all: 5 } },
      { channel: 'WEB', _count: { _all: 3 } },
    ]);
    const rows = await new DashboardQueryService(db).run('t1', { ...KPI_SPEC, dimension: 'channel', vizType: 'bar' });
    expect(rows).toEqual([{ label: 'API', value: 5 }, { label: 'WEB', value: 3 }]);
    expect((db.inferenceSession.groupBy as ReturnType<typeof vi.fn>).mock.calls[0][0].where.tenantId).toBe('t1');
  });

  it('time-series: passes tenantId as a bound param to raw SQL', async () => {
    const db = makeDb();
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ bucket: new Date('2026-06-01'), value: 7 }]);
    const rows = await new DashboardQueryService(db).run('t1', { ...KPI_SPEC, timeBucket: 'day', vizType: 'line' });
    expect(rows[0].value).toBe(7);
    expect(db.$queryRaw).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/shared && bunx vitest run src/services/dashboard-query-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `libs/shared/src/services/dashboard-query-service.ts`:

```ts
import { Prisma } from '@prisma/client';
import { createLogger } from '../logging/logger';
import { resolveSpec, type WidgetQuerySpec } from '../dashboards/widget-query-spec';
import type { ResolvedSpec } from '../dashboards/widget-query-spec';

const logger = createLogger('service:dashboard-query');
export const TOP_N = 20;

export interface QueryResultRow {
  label: string;
  value: number;
}

export interface DashboardQueryDb {
  $queryRaw: (query: Prisma.Sql) => Promise<unknown>;
  inferenceSession: { groupBy: Function; count: Function; aggregate: Function };
  sessionAnalytics: { groupBy: Function; count: Function; aggregate: Function };
}

export class DashboardQueryService {
  constructor(private readonly db: DashboardQueryDb) {}

  async run(tenantId: string, spec: WidgetQuerySpec): Promise<QueryResultRow[]> {
    try {
      const resolved = resolveSpec(spec);
      if (resolved.timeBucket) return this.runTimeSeries(tenantId, resolved);
      if (resolved.dimension) return this.runGrouped(tenantId, resolved);
      return this.runScalar(tenantId, resolved);
    } catch (error) {
      logger.error({ err: error, tenantId, source: spec.source }, 'Dashboard query failed');
      throw error;
    }
  }

  private prismaWhere(tenantId: string, r: ResolvedSpec): Record<string, unknown> {
    const where: Record<string, unknown> = { tenantId };
    where[r.source.timeColumn] = { gte: r.range.from, lte: r.range.to };
    for (const f of r.filters) {
      where[f.column] = f.op === 'in' ? { in: f.value as unknown[] } : f.value;
    }
    return where;
  }

  private model(r: ResolvedSpec) {
    return r.source.model === 'inferenceSession' ? this.db.inferenceSession : this.db.sessionAnalytics;
  }

  private aggregateSelect(r: ResolvedSpec) {
    if (r.metric.agg === 'count') return { _count: { _all: true } };
    const fld = r.metric.column as string;
    return r.metric.agg === 'avg' ? { _avg: { [fld]: true } } : { _sum: { [fld]: true } };
  }

  private readAggValue(r: ResolvedSpec, agg: Record<string, unknown>): number {
    if (r.metric.agg === 'count') return (agg._count as { _all?: number })?._all ?? (agg._count as number) ?? 0;
    const fld = r.metric.column as string;
    const bucket = (r.metric.agg === 'avg' ? agg._avg : agg._sum) as Record<string, number | null>;
    return bucket?.[fld] ?? 0;
  }

  private async runScalar(tenantId: string, r: ResolvedSpec): Promise<QueryResultRow[]> {
    const where = this.prismaWhere(tenantId, r);
    if (r.metric.agg === 'count') {
      const value = (await this.model(r).count({ where })) as number;
      return [{ label: r.metric.label, value }];
    }
    const agg = (await this.model(r).aggregate({ where, ...this.aggregateSelect(r) })) as Record<string, unknown>;
    return [{ label: r.metric.label, value: this.readAggValue(r, agg) }];
  }

  private async runGrouped(tenantId: string, r: ResolvedSpec): Promise<QueryResultRow[]> {
    const col = r.dimension!.column;
    const rows = (await this.model(r).groupBy({
      by: [col],
      where: this.prismaWhere(tenantId, r),
      ...this.aggregateSelect(r),
    })) as Record<string, unknown>[];
    const mapped = rows.map((row) => ({
      label: String(row[col] ?? 'Unknown'),
      value: this.readAggValue(r, row),
    }));
    mapped.sort((a, b) => b.value - a.value);
    if (mapped.length <= TOP_N) return mapped;
    const top = mapped.slice(0, TOP_N);
    const other = mapped.slice(TOP_N).reduce((sum, row) => sum + row.value, 0);
    return [...top, { label: 'Other', value: other }];
  }

  private async runTimeSeries(tenantId: string, r: ResolvedSpec): Promise<QueryResultRow[]> {
    // Identifiers come from the registry (constants), never the request.
    const table = Prisma.raw(`"${r.source.table}"`);
    const timeCol = Prisma.raw(`"${r.source.timeColumn}"`);
    const bucket = Prisma.raw(`'${r.timeBucket}'`); // allow-listed: 'day' | 'week' | 'month'
    const aggExpr =
      r.metric.agg === 'count'
        ? Prisma.raw('COUNT(*)')
        : Prisma.raw(`${r.metric.agg.toUpperCase()}("${r.metric.column}")`);

    const filterClauses: Prisma.Sql[] = [];
    for (const f of r.filters) {
      const fcol = Prisma.raw(`"${f.column}"`);
      filterClauses.push(
        f.op === 'in'
          ? Prisma.sql` AND ${fcol} IN (${Prisma.join(f.value as unknown[])})`
          : Prisma.sql` AND ${fcol} = ${f.value}`,
      );
    }

    const rows = (await this.db.$queryRaw(Prisma.sql`
      SELECT date_trunc(${bucket}, ${timeCol}) AS bucket, ${aggExpr}::float AS value
      FROM ${table}
      WHERE "tenantId" = ${tenantId}
        AND ${timeCol} >= ${r.range.from}
        AND ${timeCol} <= ${r.range.to}
        ${Prisma.join(filterClauses, '')}
      GROUP BY bucket
      ORDER BY bucket ASC
    `)) as { bucket: Date; value: number }[];

    return rows.map((row) => ({ label: new Date(row.bucket).toISOString(), value: Number(row.value) ?? 0 }));
  }
}
```

> Note on `Prisma.join(filterClauses, '')`: if `filterClauses` is empty, replace with a conditional — build the full `Prisma.sql` with a spread helper. Simplest robust form: compute `const filterSql = filterClauses.reduce((acc, c) => Prisma.sql`${acc}${c}`, Prisma.empty)` and interpolate `${filterSql}` instead of the `Prisma.join`. Use that form.

- [ ] **Step 4: Apply the empty-filter-safe form**

Edit the time-series method: replace `${Prisma.join(filterClauses, '')}` with `${filterSql}` and add above the query:

```ts
    const filterSql = filterClauses.reduce((acc, c) => Prisma.sql`${acc}${c}`, Prisma.empty);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd libs/shared && bunx vitest run src/services/dashboard-query-service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Export + commit**

In `libs/shared/src/index.ts` add near the other service exports:

```ts
export { DashboardQueryService, TOP_N } from './services/dashboard-query-service';
export type { DashboardQueryDb, QueryResultRow } from './services/dashboard-query-service';
```

```bash
git add libs/shared/src/services/dashboard-query-service.ts libs/shared/src/services/dashboard-query-service.test.ts libs/shared/src/index.ts
git commit -m "feat(dashboards): tenant-scoped query execution service"
```

---

## Task 3: Prisma models + migration

**Files:**
- Modify: `prisma/schema.prisma` (add 2 models + `dashboards` relation on `Tenant`)

**Interfaces:**
- Produces: Prisma models `Dashboard`, `DashboardWidget` and client accessors `prisma.dashboard`, `prisma.dashboardWidget`.

- [ ] **Step 1: Add the relation to `Tenant`**

In `prisma/schema.prisma`, inside `model Tenant { ... }` relations block (around lines 13–46), add a line alongside the other relations:

```prisma
  dashboards Dashboard[]
```

- [ ] **Step 2: Add the two models**

Append to `prisma/schema.prisma`:

```prisma
model Dashboard {
  id          String            @id @default(cuid())
  tenantId    String
  name        String
  description String?
  isDefault   Boolean           @default(false)
  createdById String
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  tenant  Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  widgets DashboardWidget[]

  @@index([tenantId])
  @@map("dashboards")
}

model DashboardWidget {
  id          String   @id @default(cuid())
  dashboardId String
  tenantId    String
  title       String
  vizType     String
  querySpec   Json
  layout      Json
  order       Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  dashboard Dashboard @relation(fields: [dashboardId], references: [id], onDelete: Cascade)

  @@index([dashboardId])
  @@index([tenantId])
  @@map("dashboard_widgets")
}
```

- [ ] **Step 3: Generate client + push schema**

Run:
```bash
bunx prisma generate --schema=./prisma/schema.prisma
bunx prisma db push
```
Expected: client regenerated; `dashboards` and `dashboard_widgets` tables created. No errors.

- [ ] **Step 4: Verify the client typings**

Run: `cd libs/shared && bunx tsc --noEmit -p tsconfig.lib.json 2>&1 | head -20`
Expected: no errors referencing `dashboard`/`dashboardWidget`. (If the project has no such tsconfig, run the repo's typecheck script instead, e.g. `nx run shared:typecheck` or `bunx tsc --noEmit`.)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(dashboards): add Dashboard and DashboardWidget models"
```

---

## Task 4: RBAC — Dashboards module

**Files:**
- Modify: `libs/shared/src/rbac/types.ts`
- Modify: `libs/shared/src/rbac/permissions.ts`
- Test: `libs/shared/src/rbac/permissions.test.ts` (create if absent)

**Interfaces:**
- Produces: `Module` union includes `'Dashboards'`; `SUBJECT_TO_MODULE.Dashboard = 'Dashboards'`; `ROLE_PERMISSIONS[*].Dashboards` populated.

- [ ] **Step 1: Write the failing test**

Create/append `libs/shared/src/rbac/permissions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hasPermission, ROLE_PERMISSIONS } from './permissions';
import { SUBJECT_TO_MODULE } from './types';

describe('Dashboards RBAC', () => {
  it('maps the Dashboard subject to the Dashboards module', () => {
    expect(SUBJECT_TO_MODULE.Dashboard).toBe('Dashboards');
  });
  it('grants Admin full dashboard control and Viewer read-only', () => {
    expect(hasPermission('Admin', 'create', 'Dashboards')).toBe(true);
    expect(hasPermission('Viewer', 'create', 'Dashboards')).toBe(false);
    expect(hasPermission('Viewer', 'read', 'Dashboards')).toBe(true);
  });
  it('declares Dashboards for every role', () => {
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      expect(ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS].Dashboards).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd libs/shared && bunx vitest run src/rbac/permissions.test.ts`
Expected: FAIL — `Dashboards` not assignable / `SUBJECT_TO_MODULE.Dashboard` undefined.

- [ ] **Step 3: Add `Dashboards` to the Module union and subject map**

In `libs/shared/src/rbac/types.ts`:

```ts
export type Module = 'Settings' | 'Users' | 'Tenants' | 'Agents' | 'KnowledgeBases' | 'McpServers' | 'LlmProviders' | 'Evaluation' | 'Dashboards';
```

And add to `SUBJECT_TO_MODULE` (before the closing brace):

```ts
  Dashboard: 'Dashboards',
  DashboardWidget: 'Dashboards',
```

- [ ] **Step 4: Add `Dashboards` to every role**

In `libs/shared/src/rbac/permissions.ts`, add a `Dashboards` line to each role in `ROLE_PERMISSIONS`:

```ts
  // Owner
  Dashboards: ['create', 'read', 'update', 'delete'],
  // Admin
  Dashboards: ['create', 'read', 'update', 'delete'],
  // Member
  Dashboards: ['create', 'read', 'update'],
  // Viewer
  Dashboards: ['read'],
```

Then update `getAutoLevel`'s `maxPossible` comment/value from `32 // 8 modules * 4 actions` to `36 // 9 modules * 4 actions`:

```ts
  const maxPossible = 36; // 9 modules * 4 actions
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd libs/shared && bunx vitest run src/rbac/permissions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add libs/shared/src/rbac
git commit -m "feat(dashboards): add Dashboards RBAC module"
```

---

## Task 5: Dashboard CRUD service

**Files:**
- Create: `libs/shared/src/services/dashboard-service.ts`
- Test: `libs/shared/src/services/dashboard-service.test.ts`
- Modify: `libs/shared/src/index.ts`
- Modify: `libs/shared/src/validation/schemas/dashboards.ts` (create) + `libs/shared/src/validation/schemas/index.ts` (export)

**Interfaces:**
- Consumes: `widgetQuerySpecSchema` (Task 1), Prisma `dashboard`/`dashboardWidget` (Task 3).
- Produces:
  - Zod: `createDashboardSchema`, `updateDashboardSchema`, `createWidgetSchema`, `updateWidgetSchema`, `widgetLayoutSchema`.
  - `interface DashboardDb { dashboard: {...}; dashboardWidget: {...} }`
  - `class DashboardService { constructor(db); listByTenant(tenantId); getById(tenantId, id); create(tenantId, userId, input); update(tenantId, id, input); remove(tenantId, id); addWidget(tenantId, dashboardId, input); updateWidget(tenantId, widgetId, input); removeWidget(tenantId, widgetId); saveLayout(tenantId, dashboardId, layouts) }`

- [ ] **Step 1: Create the validation schemas**

Create `libs/shared/src/validation/schemas/dashboards.ts`:

```ts
import { z } from 'zod';
import { widgetQuerySpecSchema } from '../../dashboards/widget-query-spec';

export const widgetLayoutSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20),
});

export const createDashboardSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
});

export const updateDashboardSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
});

export const createWidgetSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100),
  querySpec: widgetQuerySpecSchema,
  layout: widgetLayoutSchema,
});

export const updateWidgetSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  querySpec: widgetQuerySpecSchema.optional(),
  layout: widgetLayoutSchema.optional(),
});

export const saveLayoutSchema = z.object({
  layouts: z.array(z.object({ id: z.string().min(1), layout: widgetLayoutSchema })),
});
```

In `libs/shared/src/validation/schemas/index.ts`, add: `export * from './dashboards';` (match the file's existing export style — check the file first; if it lists modules individually, follow that).

- [ ] **Step 2: Write the failing test**

Create `libs/shared/src/services/dashboard-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { DashboardService, type DashboardDb } from './dashboard-service';

function makeDb(): DashboardDb {
  return {
    dashboard: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    dashboardWidget: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
  } as unknown as DashboardDb;
}

describe('DashboardService', () => {
  it('listByTenant scopes to tenant', async () => {
    const db = makeDb();
    (db.dashboard.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await new DashboardService(db).listByTenant('t1');
    expect((db.dashboard.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where).toEqual({ tenantId: 't1' });
  });

  it('create persists tenantId and createdById', async () => {
    const db = makeDb();
    (db.dashboard.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'd1' });
    await new DashboardService(db).create('t1', 'u1', { name: 'Ops' });
    const data = (db.dashboard.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(data.tenantId).toBe('t1');
    expect(data.createdById).toBe('u1');
  });

  it('addWidget rejects when dashboard not owned by tenant', async () => {
    const db = makeDb();
    (db.dashboard.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      new DashboardService(db).addWidget('t1', 'd1', { title: 'X', querySpec: { source: 'sessions', metric: { key: 'count' }, dateRange: { preset: 'last_30d' }, filters: [], vizType: 'kpi' }, layout: { x: 0, y: 0, w: 4, h: 4 } }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd libs/shared && bunx vitest run src/services/dashboard-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the service**

Create `libs/shared/src/services/dashboard-service.ts`:

```ts
import { createLogger } from '../logging/logger';
import type { z } from 'zod';
import type {
  createDashboardSchema,
  updateDashboardSchema,
  createWidgetSchema,
  updateWidgetSchema,
} from '../validation/schemas/dashboards';

const logger = createLogger('service:dashboard');

type CreateDashboardInput = z.infer<typeof createDashboardSchema>;
type UpdateDashboardInput = z.infer<typeof updateDashboardSchema>;
type CreateWidgetInput = z.infer<typeof createWidgetSchema>;
type UpdateWidgetInput = z.infer<typeof updateWidgetSchema>;

export interface DashboardDb {
  dashboard: {
    findMany: Function;
    findFirst: Function;
    create: Function;
    update: Function;
    delete: Function;
  };
  dashboardWidget: { create: Function; update: Function; delete: Function; findFirst: Function };
}

export class DashboardService {
  constructor(private readonly db: DashboardDb) {}

  async listByTenant(tenantId: string) {
    try {
      return await this.db.dashboard.findMany({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, name: true, description: true, isDefault: true, updatedAt: true },
      });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to list dashboards');
      throw error;
    }
  }

  async getById(tenantId: string, id: string) {
    try {
      return await this.db.dashboard.findFirst({
        where: { id, tenantId },
        include: { widgets: { orderBy: { order: 'asc' } } },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, dashboardId: id }, 'Failed to load dashboard');
      throw error;
    }
  }

  async create(tenantId: string, userId: string, input: CreateDashboardInput) {
    try {
      return await this.db.dashboard.create({ data: { ...input, tenantId, createdById: userId } });
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Failed to create dashboard');
      throw error;
    }
  }

  async update(tenantId: string, id: string, input: UpdateDashboardInput) {
    try {
      await this.assertOwned(tenantId, id);
      return await this.db.dashboard.update({ where: { id }, data: input });
    } catch (error) {
      logger.error({ err: error, tenantId, dashboardId: id }, 'Failed to update dashboard');
      throw error;
    }
  }

  async remove(tenantId: string, id: string) {
    try {
      await this.assertOwned(tenantId, id);
      return await this.db.dashboard.delete({ where: { id } });
    } catch (error) {
      logger.error({ err: error, tenantId, dashboardId: id }, 'Failed to delete dashboard');
      throw error;
    }
  }

  async addWidget(tenantId: string, dashboardId: string, input: CreateWidgetInput) {
    try {
      await this.assertOwned(tenantId, dashboardId);
      return await this.db.dashboardWidget.create({
        data: { dashboardId, tenantId, title: input.title, vizType: input.querySpec.vizType, querySpec: input.querySpec, layout: input.layout },
      });
    } catch (error) {
      logger.error({ err: error, tenantId, dashboardId }, 'Failed to add widget');
      throw error;
    }
  }

  async updateWidget(tenantId: string, widgetId: string, input: UpdateWidgetInput) {
    try {
      const widget = await this.db.dashboardWidget.findFirst({ where: { id: widgetId, tenantId } });
      if (!widget) throw new Error('Widget not found');
      const data: Record<string, unknown> = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.layout !== undefined) data.layout = input.layout;
      if (input.querySpec !== undefined) {
        data.querySpec = input.querySpec;
        data.vizType = input.querySpec.vizType;
      }
      return await this.db.dashboardWidget.update({ where: { id: widgetId }, data });
    } catch (error) {
      logger.error({ err: error, tenantId, widgetId }, 'Failed to update widget');
      throw error;
    }
  }

  async removeWidget(tenantId: string, widgetId: string) {
    try {
      const widget = await this.db.dashboardWidget.findFirst({ where: { id: widgetId, tenantId } });
      if (!widget) throw new Error('Widget not found');
      return await this.db.dashboardWidget.delete({ where: { id: widgetId } });
    } catch (error) {
      logger.error({ err: error, tenantId, widgetId }, 'Failed to remove widget');
      throw error;
    }
  }

  async saveLayout(tenantId: string, dashboardId: string, layouts: { id: string; layout: unknown }[]) {
    try {
      await this.assertOwned(tenantId, dashboardId);
      await Promise.all(
        layouts.map((l) => this.db.dashboardWidget.update({ where: { id: l.id }, data: { layout: l.layout } })),
      );
    } catch (error) {
      logger.error({ err: error, tenantId, dashboardId }, 'Failed to save layout');
      throw error;
    }
  }

  private async assertOwned(tenantId: string, dashboardId: string) {
    const found = await this.db.dashboard.findFirst({ where: { id: dashboardId, tenantId }, select: { id: true } });
    if (!found) throw new Error('Dashboard not found');
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd libs/shared && bunx vitest run src/services/dashboard-service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Export + commit**

In `libs/shared/src/index.ts`:

```ts
export { DashboardService } from './services/dashboard-service';
export type { DashboardDb } from './services/dashboard-service';
```

```bash
git add libs/shared/src/services/dashboard-service.ts libs/shared/src/services/dashboard-service.test.ts libs/shared/src/validation/schemas/dashboards.ts libs/shared/src/validation/schemas/index.ts libs/shared/src/index.ts
git commit -m "feat(dashboards): dashboard CRUD service + validation schemas"
```

---

## Task 6: API routes

All routes: `export const dynamic = 'force-dynamic'`, guarded by `getSessionTenantId` + `authorize(..., 'Dashboard', authOptions)`, Zod-validated, Pino-logged.

**Files:**
- Create: `apps/web-ui/app/api/dashboards/route.ts` (GET list, POST create)
- Create: `apps/web-ui/app/api/dashboards/[id]/route.ts` (GET, PUT, DELETE)
- Create: `apps/web-ui/app/api/dashboards/[id]/layout/route.ts` (PUT save layout)
- Create: `apps/web-ui/app/api/dashboards/[id]/widgets/route.ts` (POST add widget)
- Create: `apps/web-ui/app/api/dashboards/[id]/widgets/[wid]/route.ts` (PUT, DELETE)
- Create: `apps/web-ui/app/api/dashboards/query/route.ts` (POST execute spec)
- Create: `apps/web-ui/app/api/dashboards/registry/route.ts` (GET registry meta)

**Interfaces:**
- Consumes: `DashboardService`, `DashboardQueryService`, `getRegistryMeta`, the Zod schemas, `getSessionTenantId`, `authorize`, `getSessionUserId` (verify this helper exists — see Step 1).

- [ ] **Step 1: Confirm session helpers**

Run: `grep -rn "getSessionUserId\|getSessionTenantId\|user.id" libs/shared/src/auth/auth-session.ts`
Expected: find how the user id is read from the session. If `getSessionUserId(authOptions)` does not exist, read `auth-session.ts` and use the equivalent (e.g. `getServerSession(authOptions)` then `session.user.id`). Use whichever exists for `createdById`. Record the chosen call; reuse it in Step 3.

- [ ] **Step 2: Create the registry route (no DB — simplest first)**

Create `apps/web-ui/app/api/dashboards/registry/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getRegistryMeta } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { createLogger } from '@chatbot/shared';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dashboards:registry');

export async function GET() {
  try {
    await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Dashboard', authOptions);
    if (authError) return authError;
    return NextResponse.json({ sources: getRegistryMeta() });
  } catch (error) {
    logger.error({ err: error }, 'Failed to load dashboard registry');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create the list/create route**

Create `apps/web-ui/app/api/dashboards/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, DashboardService, createDashboardSchema, createLogger } from '@chatbot/shared';
import type { DashboardDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dashboards');

function service() {
  return new DashboardService(getPrismaClient() as unknown as DashboardDb);
}

export async function GET() {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Dashboard', authOptions);
    if (authError) return authError;
    const dashboards = await service().listByTenant(tenantId);
    return NextResponse.json({ dashboards });
  } catch (error) {
    logger.error({ err: error }, 'Failed to list dashboards');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'Dashboard', authOptions);
    if (authError) return authError;
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id ?? '';

    const raw = await req.json().catch(() => null);
    const parsed = createDashboardSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: { type: 'validation_error', issues: parsed.error.issues } }, { status: 422 });

    const dashboard = await service().create(tenantId, userId, parsed.data);
    return NextResponse.json({ dashboard }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'Failed to create dashboard');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}
```

> Replace the `getServerSession`/`userId` lines with the helper confirmed in Step 1 if one exists.

- [ ] **Step 4: Create the `[id]` route (GET/PUT/DELETE)**

Create `apps/web-ui/app/api/dashboards/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, DashboardService, updateDashboardSchema, createLogger } from '@chatbot/shared';
import type { DashboardDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dashboards:id');
const service = () => new DashboardService(getPrismaClient() as unknown as DashboardDb);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Dashboard', authOptions);
    if (authError) return authError;
    const dashboard = await service().getById(tenantId, id);
    if (!dashboard) return NextResponse.json({ error: { type: 'not_found', message: 'Dashboard not found' } }, { status: 404 });
    return NextResponse.json({ dashboard });
  } catch (error) {
    logger.error({ err: error }, 'Failed to load dashboard');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Dashboard', authOptions);
    if (authError) return authError;
    const parsed = updateDashboardSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: { type: 'validation_error', issues: parsed.error.issues } }, { status: 422 });
    const dashboard = await service().update(tenantId, id, parsed.data);
    return NextResponse.json({ dashboard });
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return NextResponse.json({ error: { type: 'not_found', message: error.message } }, { status: 404 });
    logger.error({ err: error }, 'Failed to update dashboard');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('delete', 'Dashboard', authOptions);
    if (authError) return authError;
    await service().remove(tenantId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return NextResponse.json({ error: { type: 'not_found', message: error.message } }, { status: 404 });
    logger.error({ err: error }, 'Failed to delete dashboard');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}
```

> Note: Next.js 15 dynamic route `params` is a `Promise` — `await params`. Confirm against an existing dynamic route (e.g. `app/api/sessions/[id]/route.ts`); match its exact signature style.

- [ ] **Step 5: Create the layout route**

Create `apps/web-ui/app/api/dashboards/[id]/layout/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, DashboardService, saveLayoutSchema, createLogger } from '@chatbot/shared';
import type { DashboardDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dashboards:layout');

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Dashboard', authOptions);
    if (authError) return authError;
    const parsed = saveLayoutSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: { type: 'validation_error', issues: parsed.error.issues } }, { status: 422 });
    await new DashboardService(getPrismaClient() as unknown as DashboardDb).saveLayout(tenantId, id, parsed.data.layouts);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ err: error }, 'Failed to save layout');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}
```

- [ ] **Step 6: Create the widgets routes**

Create `apps/web-ui/app/api/dashboards/[id]/widgets/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, DashboardService, createWidgetSchema, createLogger } from '@chatbot/shared';
import type { DashboardDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dashboards:widgets');

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Dashboard', authOptions);
    if (authError) return authError;
    const parsed = createWidgetSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: { type: 'validation_error', issues: parsed.error.issues } }, { status: 422 });
    const widget = await new DashboardService(getPrismaClient() as unknown as DashboardDb).addWidget(tenantId, id, parsed.data);
    return NextResponse.json({ widget }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return NextResponse.json({ error: { type: 'not_found', message: error.message } }, { status: 404 });
    logger.error({ err: error }, 'Failed to add widget');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}
```

Create `apps/web-ui/app/api/dashboards/[id]/widgets/[wid]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, DashboardService, updateWidgetSchema, createLogger } from '@chatbot/shared';
import type { DashboardDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dashboards:widget');
const service = () => new DashboardService(getPrismaClient() as unknown as DashboardDb);

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; wid: string }> }) {
  try {
    const { wid } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Dashboard', authOptions);
    if (authError) return authError;
    const parsed = updateWidgetSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: { type: 'validation_error', issues: parsed.error.issues } }, { status: 422 });
    const widget = await service().updateWidget(tenantId, wid, parsed.data);
    return NextResponse.json({ widget });
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return NextResponse.json({ error: { type: 'not_found', message: error.message } }, { status: 404 });
    logger.error({ err: error }, 'Failed to update widget');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; wid: string }> }) {
  try {
    const { wid } = await params;
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'Dashboard', authOptions);
    if (authError) return authError;
    await service().removeWidget(tenantId, wid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return NextResponse.json({ error: { type: 'not_found', message: error.message } }, { status: 404 });
    logger.error({ err: error }, 'Failed to remove widget');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}
```

- [ ] **Step 7: Create the query route**

Create `apps/web-ui/app/api/dashboards/query/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, DashboardQueryService, widgetQuerySpecSchema, ValidationError, createLogger } from '@chatbot/shared';
import type { DashboardQueryDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dashboards:query');

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Dashboard', authOptions);
    if (authError) return authError;
    const parsed = widgetQuerySpecSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: { type: 'validation_error', issues: parsed.error.issues } }, { status: 422 });
    const rows = await new DashboardQueryService(getPrismaClient() as unknown as DashboardQueryDb).run(tenantId, parsed.data);
    return NextResponse.json({ rows });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: { type: 'validation_error', issues: error.issues } }, { status: 422 });
    logger.error({ err: error }, 'Dashboard query failed');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}
```

- [ ] **Step 8: Smoke-test the routes manually**

Run the dev server (`bun run dev`) and, logged in, in the browser console or via authenticated `curl`:
```bash
curl -s http://localhost:3005/api/dashboards/registry -H "cookie: <session>" | head
```
Expected: `{ "sources": [ { "key": "sessions", ... }, { "key": "session_analytics", ... } ] }`. (Full coverage comes from the e2e task; this is a sanity check.)

- [ ] **Step 9: Typecheck + commit**

Run: `nx run web-ui:typecheck` (or `cd apps/web-ui && bunx tsc --noEmit`)
Expected: no errors in the new route files.

```bash
git add apps/web-ui/app/api/dashboards
git commit -m "feat(dashboards): API routes for CRUD, layout, query, registry"
```

---

## Task 7: Frontend — install react-grid-layout + WidgetRenderer

**Files:**
- Modify: `apps/web-ui/package.json` (or root, matching where deps live — check first)
- Create: `apps/web-ui/lib/dashboards/types.ts` (shared client types)
- Create: `apps/web-ui/components/dashboards/widget-renderer.tsx`
- Create: `apps/web-ui/app/(dashboard)/dashboards/dashboards.css` (import react-grid-layout CSS)

**Interfaces:**
- Produces:
  - `apps/web-ui/lib/dashboards/types.ts`: re-export client-safe types — `WidgetQuerySpec`, `VizType`, `SourceMeta`, `QueryResultRow` from `@chatbot/shared`; `interface WidgetDTO { id: string; title: string; vizType: VizType; querySpec: WidgetQuerySpec; layout: { x: number; y: number; w: number; h: number } }`; `interface DashboardDTO { id: string; name: string; description?: string; isDefault: boolean; widgets: WidgetDTO[] }`.
  - `<WidgetRenderer vizType data title />` — maps viz → recharts/KPI card.

- [ ] **Step 1: Install react-grid-layout**

Check where runtime deps are declared: `grep -l "recharts" apps/web-ui/package.json package.json`. Install in the same place:
```bash
bun add react-grid-layout && bun add -d @types/react-grid-layout
```
Expected: both appear in the resolved `package.json`. Run `bun install` to be sure the lockfile updates.

- [ ] **Step 2: Create client types**

Create `apps/web-ui/lib/dashboards/types.ts`:

```ts
import type { WidgetQuerySpec, VizType, SourceMeta, QueryResultRow } from '@chatbot/shared';

export type { WidgetQuerySpec, VizType, SourceMeta, QueryResultRow };

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetDTO {
  id: string;
  title: string;
  vizType: VizType;
  querySpec: WidgetQuerySpec;
  layout: WidgetLayout;
}

export interface DashboardListItem {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  updatedAt: string;
}

export interface DashboardDTO extends Omit<DashboardListItem, 'updatedAt'> {
  widgets: WidgetDTO[];
}
```

- [ ] **Step 3: Write the renderer**

Create `apps/web-ui/components/dashboards/widget-renderer.tsx`:

```tsx
'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { QueryResultRow, VizType } from '@/lib/dashboards/types';

const PALETTE = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];
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
```

> Verify the CSS chart vars (`--chart-2`…`--chart-5`) exist in `globals.css`. If only `--primary` exists, set `PALETTE` to shades of `--primary` or add the chart vars (shadcn chart preset). Check: `grep -n "chart-" apps/web-ui/app/globals.css`.

- [ ] **Step 4: Add the grid CSS import file**

Create `apps/web-ui/app/(dashboard)/dashboards/dashboards.css`:

```css
@import 'react-grid-layout/css/styles.css';
@import 'react-resizable/css/styles.css';
```

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/web-ui && bunx tsc --noEmit 2>&1 | grep dashboards | head`
Expected: no errors for these files.

```bash
git add apps/web-ui/components/dashboards apps/web-ui/lib/dashboards "apps/web-ui/app/(dashboard)/dashboards/dashboards.css" apps/web-ui/package.json package.json bun.lock
git commit -m "feat(dashboards): widget renderer + react-grid-layout setup"
```

---

## Task 8: Frontend — widget builder

A shadcn `Sheet` with config controls on the left and a live preview (calls `/api/dashboards/query`) on the right. Field options come from `GET /api/dashboards/registry`.

**Files:**
- Create: `apps/web-ui/components/dashboards/use-registry.ts` (React Query hook)
- Create: `apps/web-ui/components/dashboards/use-widget-data.ts` (React Query hook)
- Create: `apps/web-ui/components/dashboards/widget-builder.tsx`

**Interfaces:**
- Consumes: `SourceMeta`, `WidgetQuerySpec`, `WidgetRenderer`, shadcn `Sheet`, `Select`, `Input`, `Button`, `Label`, `ToggleGroup`/`Tabs`.
- Produces:
  - `useRegistry(): { data?: { sources: SourceMeta[] }; isLoading }`
  - `useWidgetData(spec: WidgetQuerySpec | null): { data?: { rows: QueryResultRow[] }; isLoading; error }`
  - `<WidgetBuilder open onOpenChange initialSpec? initialTitle? onSave(input: { title; querySpec; layout }) />` — emits a `CreateWidgetInput`-shaped object; layout defaults to `{ x: 0, y: Infinity, w: 6, h: 6 }` for new widgets (grid places at bottom).

- [ ] **Step 1: Create the data hooks**

Create `apps/web-ui/components/dashboards/use-registry.ts`:

```ts
'use client';
import { useQuery } from '@tanstack/react-query';
import type { SourceMeta } from '@/lib/dashboards/types';

export function useRegistry() {
  return useQuery({
    queryKey: ['dashboard-registry'],
    queryFn: async (): Promise<{ sources: SourceMeta[] }> => {
      const res = await fetch('/api/dashboards/registry');
      if (!res.ok) throw new Error('Failed to load registry');
      return res.json();
    },
    staleTime: Infinity,
  });
}
```

Create `apps/web-ui/components/dashboards/use-widget-data.ts`:

```ts
'use client';
import { useQuery } from '@tanstack/react-query';
import type { QueryResultRow, WidgetQuerySpec } from '@/lib/dashboards/types';

export function useWidgetData(spec: WidgetQuerySpec | null) {
  return useQuery({
    queryKey: ['widget-data', spec],
    enabled: spec !== null,
    queryFn: async (): Promise<{ rows: QueryResultRow[] }> => {
      const res = await fetch('/api/dashboards/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(spec),
      });
      if (!res.ok) throw new Error('Query failed');
      return res.json();
    },
    staleTime: 1000 * 60 * 3,
  });
}
```

- [ ] **Step 2: Build the builder UI**

Create `apps/web-ui/components/dashboards/widget-builder.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useRegistry } from './use-registry';
import { useWidgetData } from './use-widget-data';
import { WidgetRenderer } from './widget-renderer';
import type { VizType, WidgetQuerySpec } from '@/lib/dashboards/types';

const VIZ_TYPES: VizType[] = ['line', 'area', 'bar', 'pie', 'kpi'];
const PRESETS = [
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' },
] as const;

export interface WidgetBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: { title: string; querySpec: WidgetQuerySpec; layout: { x: number; y: number; w: number; h: number } }) => void;
}

export function WidgetBuilder({ open, onOpenChange, onSave }: WidgetBuilderProps) {
  const { data: registry } = useRegistry();
  const sources = registry?.sources ?? [];

  const [title, setTitle] = useState('Untitled widget');
  const [sourceKey, setSourceKey] = useState<string>('');
  const [metricKey, setMetricKey] = useState<string>('');
  const [dimension, setDimension] = useState<string>('none');
  const [timeBucket, setTimeBucket] = useState<string>('none');
  const [preset, setPreset] = useState<'last_7d' | 'last_30d' | 'last_90d'>('last_30d');
  const [vizType, setVizType] = useState<VizType>('bar');

  const source = sources.find((s) => s.key === sourceKey);
  const metric = source?.metrics.find((m) => m.key === metricKey);

  const spec: WidgetQuerySpec | null = useMemo(() => {
    if (!source || !metric) return null;
    return {
      source: source.key,
      metric: { key: metric.key },
      dimension: dimension !== 'none' && timeBucket === 'none' ? dimension : undefined,
      timeBucket: timeBucket !== 'none' ? (timeBucket as 'day' | 'week' | 'month') : undefined,
      filters: [],
      dateRange: { preset },
      vizType,
    } as WidgetQuerySpec;
  }, [source, metric, dimension, timeBucket, preset, vizType]);

  const { data, isLoading, error } = useWidgetData(open ? spec : null);

  const validViz = metric?.validViz ?? VIZ_TYPES;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add widget</SheetTitle>
        </SheetHeader>

        <div className="grid grid-cols-1 gap-6 py-4 md:grid-cols-2">
          {/* config */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Data source</Label>
              <Select value={sourceKey} onValueChange={(v) => { setSourceKey(v); setMetricKey(''); setDimension('none'); }}>
                <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                <SelectContent>
                  {sources.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Metric</Label>
              <Select value={metricKey} onValueChange={setMetricKey} disabled={!source}>
                <SelectTrigger><SelectValue placeholder="Select metric" /></SelectTrigger>
                <SelectContent>
                  {source?.metrics.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Group by</Label>
              <Select value={dimension} onValueChange={setDimension} disabled={!source || timeBucket !== 'none'}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {source?.dimensions.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Time bucket</Label>
              <Select value={timeBucket} onValueChange={(v) => { setTimeBucket(v); if (v !== 'none') setDimension('none'); }} disabled={!source}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="day">Day</SelectItem>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Date range</Label>
              <Select value={preset} onValueChange={(v) => setPreset(v as typeof preset)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Visualization</Label>
              <Select value={vizType} onValueChange={(v) => setVizType(v as VizType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VIZ_TYPES.map((v) => <SelectItem key={v} value={v} disabled={!validViz.includes(v)}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
            </div>
          </div>

          {/* preview */}
          <div className="rounded-lg border bg-card p-3">
            <div className="mb-2 text-sm font-medium">{title}</div>
            <div className="h-64">
              {!spec ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Pick a source and metric</div>
              ) : isLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
              ) : error ? (
                <div className="flex h-full items-center justify-center text-sm text-destructive">Query error</div>
              ) : (
                <WidgetRenderer vizType={vizType} data={data?.rows ?? []} />
              )}
            </div>
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!spec || !title.trim()}
            onClick={() => { if (spec) { onSave({ title: title.trim(), querySpec: spec, layout: { x: 0, y: Infinity, w: 6, h: 6 } }); onOpenChange(false); } }}
          >
            Save widget
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

> Verify `@/components/ui/label` and `@/components/ui/sheet` exist (they were listed as present). If `Label` is missing, add it: `bunx shadcn@latest add label`.

- [ ] **Step 3: Typecheck + commit**

Run: `cd apps/web-ui && bunx tsc --noEmit 2>&1 | grep -E "widget-builder|use-registry|use-widget-data" | head`
Expected: no errors.

```bash
git add apps/web-ui/components/dashboards
git commit -m "feat(dashboards): widget builder with live preview"
```

---

## Task 9: Frontend — dashboard canvas (view/edit)

**Files:**
- Create: `apps/web-ui/components/dashboards/dashboard-grid.tsx`
- Create: `apps/web-ui/components/dashboards/widget-card.tsx`
- Create: `apps/web-ui/app/(dashboard)/dashboards/[id]/page.tsx`

**Interfaces:**
- Consumes: `WidgetRenderer`, `useWidgetData`, `WidgetBuilder`, `DashboardDTO`, `WidgetDTO`, react-grid-layout's `Responsive`, `WidthProvider`.
- Produces: `<DashboardGrid dashboard editable />`, `<WidgetCard widget editable onDelete />`.

- [ ] **Step 1: Widget card (self-fetching)**

Create `apps/web-ui/components/dashboards/widget-card.tsx`:

```tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { WidgetRenderer } from './widget-renderer';
import { useWidgetData } from './use-widget-data';
import type { WidgetDTO } from '@/lib/dashboards/types';

export function WidgetCard({ widget, editable, onDelete }: { widget: WidgetDTO; editable: boolean; onDelete: (id: string) => void }) {
  const { data, isLoading, error } = useWidgetData(widget.querySpec);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
        <CardTitle className="text-sm font-medium">{widget.title}</CardTitle>
        {editable && (
          <Button variant="ghost" size="icon" className="h-6 w-6 no-drag" onClick={() => onDelete(widget.id)}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 pb-3">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-sm text-destructive">Failed to load</div>
        ) : (
          <WidgetRenderer vizType={widget.vizType} data={data?.rows ?? []} />
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: The grid**

Create `apps/web-ui/components/dashboards/dashboard-grid.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { WidgetCard } from './widget-card';
import type { DashboardDTO, WidgetDTO } from '@/lib/dashboards/types';

const ResponsiveGrid = WidthProvider(Responsive);

export function DashboardGrid({ dashboard, editable }: { dashboard: DashboardDTO; editable: boolean }) {
  const qc = useQueryClient();
  const [widgets, setWidgets] = useState<WidgetDTO[]>(dashboard.widgets);

  const saveLayout = useMutation({
    mutationFn: async (layouts: { id: string; layout: WidgetDTO['layout'] }[]) => {
      const res = await fetch(`/api/dashboards/${dashboard.id}/layout`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ layouts }),
      });
      if (!res.ok) throw new Error('Failed to save layout');
    },
  });

  const deleteWidget = useMutation({
    mutationFn: async (widgetId: string) => {
      const res = await fetch(`/api/dashboards/${dashboard.id}/widgets/${widgetId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete widget');
    },
    onSuccess: (_d, widgetId) => {
      setWidgets((w) => w.filter((x) => x.id !== widgetId));
      qc.invalidateQueries({ queryKey: ['dashboard', dashboard.id] });
    },
  });

  const layout: Layout[] = widgets.map((w) => ({ i: w.id, ...w.layout }));

  function onLayoutChange(next: Layout[]) {
    if (!editable) return;
    const updated = widgets.map((w) => {
      const l = next.find((n) => n.i === w.id);
      return l ? { ...w, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : w;
    });
    setWidgets(updated);
    saveLayout.mutate(updated.map((w) => ({ id: w.id, layout: w.layout })));
  }

  return (
    <ResponsiveGrid
      className="layout"
      layouts={{ lg: layout }}
      breakpoints={{ lg: 996, md: 768, sm: 0 }}
      cols={{ lg: 12, md: 8, sm: 4 }}
      rowHeight={60}
      isDraggable={editable}
      isResizable={editable}
      draggableCancel=".no-drag"
      onLayoutChange={onLayoutChange}
    >
      {widgets.map((w) => (
        <div key={w.id}>
          <WidgetCard widget={w} editable={editable} onDelete={(id) => deleteWidget.mutate(id)} />
        </div>
      ))}
    </ResponsiveGrid>
  );
}
```

- [ ] **Step 3: The dashboard page (view/edit toggle + add widget)**

Create `apps/web-ui/app/(dashboard)/dashboards/[id]/page.tsx`:

```tsx
'use client';

import { use, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, Check } from 'lucide-react';
import { DashboardGrid } from '@/components/dashboards/dashboard-grid';
import { WidgetBuilder } from '@/components/dashboards/widget-builder';
import type { DashboardDTO } from '@/lib/dashboards/types';
import '../dashboards.css';

export default function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', id],
    queryFn: async (): Promise<{ dashboard: DashboardDTO }> => {
      const res = await fetch(`/api/dashboards/${id}`);
      if (!res.ok) throw new Error('Failed to load dashboard');
      return res.json();
    },
  });

  const addWidget = useMutation({
    mutationFn: async (input: unknown) => {
      const res = await fetch(`/api/dashboards/${id}/widgets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to add widget');
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', id] }),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!data?.dashboard) return <div className="p-6 text-sm text-destructive">Dashboard not found</div>;

  const dashboard = data.dashboard;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{dashboard.name}</h1>
        <div className="flex gap-2">
          {editing && <Button variant="outline" onClick={() => setBuilderOpen(true)}><Plus className="mr-1 h-4 w-4" /> Add widget</Button>}
          <Button variant={editing ? 'default' : 'outline'} onClick={() => setEditing((e) => !e)}>
            {editing ? <><Check className="mr-1 h-4 w-4" /> Done</> : <><Pencil className="mr-1 h-4 w-4" /> Edit</>}
          </Button>
        </div>
      </div>

      {dashboard.widgets.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          <p>No widgets yet.</p>
          <Button className="mt-3" onClick={() => { setEditing(true); setBuilderOpen(true); }}><Plus className="mr-1 h-4 w-4" /> Add your first widget</Button>
        </div>
      ) : (
        <DashboardGrid key={dashboard.widgets.length} dashboard={dashboard} editable={editing} />
      )}

      <WidgetBuilder open={builderOpen} onOpenChange={setBuilderOpen} onSave={(input) => addWidget.mutate(input)} />
    </div>
  );
}
```

> The edit toggle should be hidden for users lacking the manage permission. The simplest server-truth approach: the `update`/widget routes already return 401/403 via `authorize`. For UI gating, check whether a client-side permission/role is available in the session (look at how other pages read `useSession()` role). If readily available, wrap the Edit button in that check; otherwise rely on server enforcement for v1 and note it.

- [ ] **Step 4: Manual verification**

Run `bun run dev`, log in, visit `/dashboards/<id>` for a dashboard created via the API. Toggle Edit → Add widget → configure → Save. Confirm the widget renders, drag/resize persists across reload.

- [ ] **Step 5: Commit**

```bash
git add apps/web-ui/components/dashboards "apps/web-ui/app/(dashboard)/dashboards/[id]/page.tsx"
git commit -m "feat(dashboards): dashboard canvas with view/edit and add-widget"
```

---

## Task 10: Frontend — dashboards list page + nav

**Files:**
- Create: `apps/web-ui/app/(dashboard)/dashboards/page.tsx`
- Modify: the sidebar/nav component (find it — Step 1)

**Interfaces:**
- Consumes: `DashboardListItem`.

- [ ] **Step 1: Locate the nav**

Run: `grep -rln "analytics\|Sessions" apps/web-ui/components --include="*.tsx" | grep -iE "nav|sidebar"`
Expected: the sidebar/nav file listing the dashboard links. Note its link-item pattern (icon + label + href).

- [ ] **Step 2: Build the list page**

Create `apps/web-ui/app/(dashboard)/dashboards/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus, LayoutDashboard } from 'lucide-react';
import type { DashboardListItem } from '@/lib/dashboards/types';

export default function DashboardsListPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['dashboards'],
    queryFn: async (): Promise<{ dashboards: DashboardListItem[] }> => {
      const res = await fetch('/api/dashboards');
      if (!res.ok) throw new Error('Failed to load dashboards');
      return res.json();
    },
  });

  const create = useMutation({
    mutationFn: async (payload: { name: string }) => {
      const res = await fetch('/api/dashboards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('Failed to create dashboard');
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dashboards'] }); setOpen(false); setName(''); },
  });

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboards</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" /> New dashboard</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create dashboard</DialogTitle></DialogHeader>
            <div className="space-y-1.5 py-2">
              <Label htmlFor="dash-name">Name</Label>
              <Input id="dash-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support overview" maxLength={100} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate({ name: name.trim() })}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (data?.dashboards.length ?? 0) === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          <LayoutDashboard className="mb-2 h-8 w-8" />
          <p>No dashboards yet. Create your first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data!.dashboards.map((d) => (
            <Link key={d.id} href={`/dashboards/${d.id}`}>
              <Card className="transition-colors hover:border-primary">
                <CardHeader>
                  <CardTitle className="text-base">{d.name}</CardTitle>
                  {d.description && <CardDescription>{d.description}</CardDescription>}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the nav link**

In the nav file found in Step 1, add a link entry matching the existing pattern, e.g.:

```tsx
{ label: 'Dashboards', href: '/dashboards', icon: LayoutDashboard },
```

(Import `LayoutDashboard` from `lucide-react` if not already imported. Place it near the existing Analytics/Sessions entries.)

- [ ] **Step 4: Manual verification + commit**

Run `bun run dev`; confirm `/dashboards` lists dashboards, "New dashboard" creates one and it appears, clicking a card opens it, and the nav link works.

```bash
git add "apps/web-ui/app/(dashboard)/dashboards/page.tsx" apps/web-ui/components
git commit -m "feat(dashboards): dashboards list page + nav link"
```

---

## Task 11: E2e module

**Files:**
- Modify: `apps/web-ui-e2e/src/constants/tags.ts` (add `dashboards` tag)
- Create: `apps/web-ui-e2e/src/modules/dashboards/dashboards.spec.ts`

**Interfaces:**
- Consumes: `{ test, expect }` from `../../fixtures/base`, `TAG` from `../../constants/tags`.

- [ ] **Step 1: Add the module tag**

In `apps/web-ui-e2e/src/constants/tags.ts`, add to the `TAG` object (match existing style):

```ts
  dashboards: '@dashboards',
```

- [ ] **Step 2: Write the spec**

Create `apps/web-ui-e2e/src/modules/dashboards/dashboards.spec.ts`:

```ts
import { test, expect } from '../../fixtures/base';
import { TAG } from '../../constants/tags';

test.describe('Custom dashboards', { tag: [TAG.dashboards, TAG.regression] }, () => {
  test('registry endpoint returns the two v1 sources', async ({ request }) => {
    const res = await request.get('/api/dashboards/registry');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const keys = body.sources.map((s: { key: string }) => s.key);
    expect(keys).toContain('sessions');
    expect(keys).toContain('session_analytics');
  });

  test('query endpoint rejects an unknown source', async ({ request }) => {
    const res = await request.post('/api/dashboards/query', {
      data: { source: 'secrets', metric: { key: 'count' }, dateRange: { preset: 'last_30d' }, filters: [], vizType: 'kpi' },
    });
    expect(res.status()).toBe(422);
  });

  test('create dashboard, add a widget, and see it render', async ({ page }) => {
    await page.goto('/dashboards');
    await page.getByRole('button', { name: /new dashboard/i }).click();
    await page.getByLabel('Name').fill('E2E Dashboard');
    await page.getByRole('button', { name: /^create$/i }).click();

    await page.getByText('E2E Dashboard').click();
    await expect(page).toHaveURL(/\/dashboards\/.+/);

    await page.getByRole('button', { name: /edit/i }).click();
    await page.getByRole('button', { name: /add (your first )?widget/i }).first().click();

    // builder
    await page.getByText('Add widget').waitFor();
    await page.getByText('Select source').click();
    await page.getByRole('option', { name: 'Sessions & messages' }).click();
    await page.getByText('Select metric').click();
    await page.getByRole('option', { name: 'Session count' }).click();
    await page.getByRole('button', { name: /save widget/i }).click();

    await expect(page.getByText('Untitled widget').or(page.locator('.react-grid-item'))).toBeVisible();
  });
});
```

> Selector note: the builder uses shadcn `Select` (Radix). If `getByText('Select source')` is brittle, switch to `getByRole('combobox')` indexing or add `data-testid` attributes to the `SelectTrigger`s in `widget-builder.tsx`. Prefer adding `data-testid` if the first run is flaky.

- [ ] **Step 3: Run the e2e module**

Run: `bun run e2e:dev --grep @dashboards` (or `nx e2e web-ui-e2e --grep @dashboards`). If an `e2e:dashboards` target is desired, mirror an existing `e2e:<module>` target in the Nx config.
Expected: 3 tests pass. Fix selectors per the note if the UI test is flaky.

- [ ] **Step 4: Commit**

```bash
git add apps/web-ui-e2e/src/constants/tags.ts apps/web-ui-e2e/src/modules/dashboards
git commit -m "test(dashboards): e2e module for custom dashboards"
```

---

## Final verification

- [ ] **Run the full unit suite:** `bun run test` — all dashboard unit tests green.
- [ ] **Typecheck:** `nx run web-ui:typecheck` and `nx test shared` (or repo equivalents) — clean.
- [ ] **Build:** `bun run build` — succeeds (react-grid-layout bundles; if SSR complains about `window`, confirm grid components are `'use client'` — they are).
- [ ] **Manual smoke:** create dashboard → add one widget of each viz type (kpi, bar over channel, line over time, pie over sentiment) → reload → layout + data persist.
- [ ] **Update docs:** add a short "Custom Dashboards" note to feature docs if the repo documents features (optional, matches existing `docs/` convention).

## Self-Review Notes (coverage vs spec)

- Source Registry security boundary → Task 1. ✅
- WidgetQuerySpec + registry-derived Zod → Task 1. ✅
- Tenant-scoped query execution, time-bucket allow-list, bound params → Task 2. ✅
- Dashboard/DashboardWidget models, Json layout, denormalized tenantId → Task 3. ✅
- RBAC Dashboards module → Task 4. ✅
- CRUD service + ownership checks → Task 5. ✅
- All API routes incl. stateless `/query` for preview+render and `/registry` → Task 6. ✅
- react-grid-layout, WidgetRenderer (line/area/bar/pie/kpi) → Task 7. ✅
- Guided builder with live preview, registry-driven options, UI-disabled invalid viz → Task 8. ✅
- Drag/resize canvas, view/edit, debounced layout save → Task 9. ✅
- List page + nav → Task 10. ✅
- E2e module + tag → Task 11. ✅
- Standards (Zod, Pino, shadcn, try/catch, tenant scoping) enforced in each task. ✅

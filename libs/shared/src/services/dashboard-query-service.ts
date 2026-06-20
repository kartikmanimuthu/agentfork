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

    const filterSql = filterClauses.reduce((acc, c) => Prisma.sql`${acc}${c}`, Prisma.empty);

    const rows = (await this.db.$queryRaw(Prisma.sql`
      SELECT date_trunc(${bucket}, ${timeCol}) AS bucket, ${aggExpr}::float AS value
      FROM ${table}
      WHERE "tenantId" = ${tenantId}
        AND ${timeCol} >= ${r.range.from}
        AND ${timeCol} <= ${r.range.to}
        ${filterSql}
      GROUP BY bucket
      ORDER BY bucket ASC
    `)) as { bucket: Date; value: number }[];

    return rows.map((row) => ({ label: new Date(row.bucket).toISOString(), value: Number(row.value) ?? 0 }));
  }
}

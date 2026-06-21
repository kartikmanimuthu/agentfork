import { z } from 'zod';
import { ValidationError } from '../validation/parse-request';
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

function makeValidationError(message: string, path: (string | number)[]): ValidationError {
  return new ValidationError([
    {
      code: z.ZodIssueCode.custom,
      path,
      message,
    },
  ]);
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
    throw makeValidationError('Date range exceeds the maximum allowed window', ['dateRange']);
  }
  return { from, to };
}

export function resolveSpec(specInput: WidgetQuerySpec): ResolvedSpec {
  const spec = widgetQuerySpecSchema.parse(specInput);
  const source = SOURCE_REGISTRY[spec.source];
  if (!source) throw makeValidationError(`Unknown data source: ${spec.source}`, ['source']);

  const metric = source.metrics.find((m) => m.key === spec.metric.key);
  if (!metric) throw makeValidationError(`Unknown metric for this source: ${spec.metric.key}`, ['metric', 'key']);
  if (metric.agg !== 'count' && !metric.column) {
    throw makeValidationError('Aggregation requires a field', ['metric']);
  }

  let dimension: DimensionDef | null = null;
  if (spec.dimension) {
    const d = source.dimensions.find((x) => x.key === spec.dimension);
    if (!d) throw makeValidationError(`Unknown dimension for this source: ${spec.dimension}`, ['dimension']);
    dimension = d;
  }

  if (!metric.validViz.includes(spec.vizType)) {
    throw makeValidationError(`Visualization '${spec.vizType}' is not valid for this metric`, ['vizType']);
  }

  const filters = spec.filters.map((f) => {
    const def = source.filters.find((x) => x.key === f.field);
    if (!def) throw makeValidationError(`Unknown filter field for this source: ${f.field}`, ['filters']);
    if (!def.ops.includes(f.op)) throw makeValidationError(`Unsupported filter operator: ${f.op}`, ['filters']);
    return { column: def.column, op: f.op, value: f.value };
  });

  return { source, metric, dimension, timeBucket: spec.timeBucket ?? null, filters, range: resolveRange(spec.dateRange), vizType: spec.vizType };
}

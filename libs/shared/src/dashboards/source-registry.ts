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

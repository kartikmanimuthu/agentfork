import { describe, it, expect } from 'vitest';
import { widgetQuerySpecSchema, resolveSpec } from './widget-query-spec';
import { ValidationError } from '../validation/parse-request';

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

import { describe, it, expect } from 'vitest';
import { SOURCE_REGISTRY, getRegistryMeta } from './source-registry';

describe('SOURCE_REGISTRY', () => {
  it('has exactly the two known v1 sources', () => {
    expect(Object.keys(SOURCE_REGISTRY)).toEqual(['sessions', 'session_analytics']);
  });
  it('each source key matches its own .key field', () => {
    for (const [k, v] of Object.entries(SOURCE_REGISTRY)) expect(v.key).toBe(k);
  });
  it('sessions has a count metric with no required column', () => {
    expect(SOURCE_REGISTRY.sessions.metrics.find((m) => m.key === 'count')?.column).toBeNull();
  });
  it('session_analytics avg_confidence metric declares a real column', () => {
    const avg = SOURCE_REGISTRY.session_analytics.metrics.find((m) => m.key === 'avg_confidence');
    expect(avg?.column).toBe('confidenceScore');
    expect(avg?.agg).toBe('avg');
  });
});

describe('getRegistryMeta', () => {
  it('never leaks raw column or table names', () => {
    const json = JSON.stringify(getRegistryMeta());
    expect(json).not.toContain('confidenceScore');
    expect(json).not.toContain('inference_sessions');
    expect(json).not.toContain('session_analytics".table');
  });
  it('marks requiresField correctly: count metrics never require a field, avg metrics do', () => {
    const meta = getRegistryMeta();
    const sessions = meta.find((s) => s.key === 'sessions')!;
    expect(sessions.metrics.find((m) => m.key === 'count')?.requiresField).toBe(false);
    const analytics = meta.find((s) => s.key === 'session_analytics')!;
    expect(analytics.metrics.find((m) => m.key === 'avg_confidence')?.requiresField).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import {
  scoreConfigCreateSchema,
  scoreManualCreateSchema,
  addFromTraceSchema,
  datasetItemCreateSchema,
} from './evaluation';

describe('scoreConfigCreateSchema', () => {
  it('accepts a NUMERIC config with bounds', () => {
    const r = scoreConfigCreateSchema.safeParse({ name: 'helpfulness', dataType: 'NUMERIC', minValue: 1, maxValue: 5 });
    expect(r.success).toBe(true);
  });
  it('rejects NUMERIC where min >= max', () => {
    const r = scoreConfigCreateSchema.safeParse({ name: 'x', dataType: 'NUMERIC', minValue: 5, maxValue: 1 });
    expect(r.success).toBe(false);
  });
  it('rejects CATEGORICAL with empty categories', () => {
    const r = scoreConfigCreateSchema.safeParse({ name: 'tone', dataType: 'CATEGORICAL', categories: [] });
    expect(r.success).toBe(false);
  });
  it('accepts CATEGORICAL with categories', () => {
    const r = scoreConfigCreateSchema.safeParse({ name: 'tone', dataType: 'CATEGORICAL', categories: [{ label: 'good', value: 1 }] });
    expect(r.success).toBe(true);
  });
});

describe('scoreManualCreateSchema', () => {
  it('accepts a message score', () => {
    const r = scoreManualCreateSchema.safeParse({ configId: 'c1', targetType: 'MESSAGE', targetId: 'm1', value: 4 });
    expect(r.success).toBe(true);
  });
  it('rejects missing value', () => {
    const r = scoreManualCreateSchema.safeParse({ configId: 'c1', targetType: 'MESSAGE', targetId: 'm1' });
    expect(r.success).toBe(false);
  });
  it('accepts EXECUTION targetType', () => {
    const r = scoreManualCreateSchema.safeParse({ configId: 'c1', targetType: 'EXECUTION', targetId: 'ex1', value: 3 });
    expect(r.success).toBe(true);
  });
});

describe('addFromTraceSchema', () => {
  it('accepts SESSION targetType', () => {
    const r = addFromTraceSchema.safeParse({ targetType: 'SESSION', targetId: 's1' });
    expect(r.success).toBe(true);
  });
  it('accepts EXECUTION targetType', () => {
    const r = addFromTraceSchema.safeParse({ targetType: 'EXECUTION', targetId: 'ex1' });
    expect(r.success).toBe(true);
  });
  it('rejects unknown targetType', () => {
    const r = addFromTraceSchema.safeParse({ targetType: 'UNKNOWN', targetId: 'x1' });
    expect(r.success).toBe(false);
  });
});

describe('datasetItemCreateSchema', () => {
  it('requires input', () => {
    expect(datasetItemCreateSchema.safeParse({}).success).toBe(false);
    expect(datasetItemCreateSchema.safeParse({ input: { q: 'hi' } }).success).toBe(true);
  });
});

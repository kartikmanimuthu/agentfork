import { describe, it, expect } from 'vitest';
import {
  scoreConfigCreateSchema,
  scoreManualCreateSchema,
  addFromTraceSchema,
  datasetItemCreateSchema,
  scoreDataTypeSchema,
  scoreTargetTypeSchema,
  scoreConfigUpdateSchema,
  scoreIngestSchema,
  scoreListQuerySchema,
  datasetCreateSchema,
  datasetUpdateSchema,
  datasetItemBulkSchema,
  datasetExportFormatSchema,
  evaluatorCreateSchema,
  evaluatorUpdateSchema,
  evaluatorRunQuerySchema,
  annotationQueueCreateSchema,
  annotationQueueUpdateSchema,
  annotationQueuePopulateSchema,
  annotationQueueItemReviewSchema,
  experimentCreateSchema,
  experimentUpdateSchema,
  experimentRunPayloadSchema,
  evaluatorRunPayloadSchema,
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

// ── Score ──────────────────────────────────────────────────────────────────
describe('scoreDataTypeSchema', () => {
  it.each(scoreDataTypeSchema.options)('accepts %s', (v) => {
    expect(scoreDataTypeSchema.safeParse(v).success).toBe(true);
  });
  it('rejects an unknown value', () => {
    expect(scoreDataTypeSchema.safeParse('NOT_A_TYPE').success).toBe(false);
  });
});

describe('scoreTargetTypeSchema', () => {
  it.each(scoreTargetTypeSchema.options)('accepts %s', (v) => {
    expect(scoreTargetTypeSchema.safeParse(v).success).toBe(true);
  });
  it('rejects an unknown value', () => {
    expect(scoreTargetTypeSchema.safeParse('NOT_A_TARGET').success).toBe(false);
  });
});

describe('scoreConfigUpdateSchema', () => {
  it('accepts an empty object', () => {
    expect(scoreConfigUpdateSchema.safeParse({}).success).toBe(true);
  });
  it('rejects an invalid dataType even though every field is optional', () => {
    expect(scoreConfigUpdateSchema.safeParse({ dataType: 'NOT_A_TYPE' }).success).toBe(false);
  });
});

describe('scoreIngestSchema', () => {
  it('behaves identically to scoreManualCreateSchema (same underlying schema)', () => {
    const valid = { configId: 'c1', targetType: 'MESSAGE', targetId: 'm1', value: 4 };
    const invalid = { configId: 'c1', targetType: 'MESSAGE', targetId: 'm1' };
    expect(scoreIngestSchema.safeParse(valid).success).toBe(true);
    expect(scoreIngestSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('scoreListQuerySchema', () => {
  it('coerces string query-param numbers for limit/offset', () => {
    const r = scoreListQuerySchema.safeParse({ limit: '50', offset: '0' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });
  it('enforces limit bounds 1-100', () => {
    expect(scoreListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(scoreListQuerySchema.safeParse({ limit: 100 }).success).toBe(true);
    expect(scoreListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});

// ── Dataset ────────────────────────────────────────────────────────────────
describe('datasetCreateSchema', () => {
  it('requires a 1-100 char name', () => {
    expect(datasetCreateSchema.safeParse({}).success).toBe(false);
    expect(datasetCreateSchema.safeParse({ name: 'a'.repeat(100) }).success).toBe(true);
    expect(datasetCreateSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false);
  });
  it('caps description at 500 chars', () => {
    expect(datasetCreateSchema.safeParse({ name: 'ok', description: 'a'.repeat(501) }).success).toBe(false);
  });
});

describe('datasetUpdateSchema', () => {
  it('accepts an empty object', () => {
    expect(datasetUpdateSchema.safeParse({}).success).toBe(true);
  });
});

describe('datasetItemBulkSchema', () => {
  it('rejects an empty items array', () => {
    expect(datasetItemBulkSchema.safeParse({ items: [] }).success).toBe(false);
  });
  it('accepts exactly 1000 items, rejects 1001', () => {
    const make = (n: number) => ({ items: Array.from({ length: n }, () => ({ input: { q: 'x' } })) });
    expect(datasetItemBulkSchema.safeParse(make(1000)).success).toBe(true);
    expect(datasetItemBulkSchema.safeParse(make(1001)).success).toBe(false);
  });
});

describe('datasetExportFormatSchema', () => {
  it('defaults to jsonl when omitted', () => {
    expect(datasetExportFormatSchema.parse(undefined)).toBe('jsonl');
  });
  it('rejects an unknown format', () => {
    expect(datasetExportFormatSchema.safeParse('xml').success).toBe(false);
  });
});

// ── Evaluator ──────────────────────────────────────────────────────────────
describe('evaluatorCreateSchema', () => {
  it('requires name, scoreConfigId, prompt', () => {
    expect(evaluatorCreateSchema.safeParse({}).success).toBe(false);
    expect(evaluatorCreateSchema.safeParse({ name: 'n', scoreConfigId: 'c1', prompt: 'p' }).success).toBe(true);
  });
  it('enforces temperature bounds 0-2', () => {
    const base = { name: 'n', scoreConfigId: 'c1', prompt: 'p' };
    expect(evaluatorCreateSchema.safeParse({ ...base, temperature: -0.1 }).success).toBe(false);
    expect(evaluatorCreateSchema.safeParse({ ...base, temperature: 0 }).success).toBe(true);
    expect(evaluatorCreateSchema.safeParse({ ...base, temperature: 2 }).success).toBe(true);
    expect(evaluatorCreateSchema.safeParse({ ...base, temperature: 2.1 }).success).toBe(false);
  });
  it('enforces maxTokens as a positive integer', () => {
    const base = { name: 'n', scoreConfigId: 'c1', prompt: 'p' };
    expect(evaluatorCreateSchema.safeParse({ ...base, maxTokens: 0 }).success).toBe(false);
    expect(evaluatorCreateSchema.safeParse({ ...base, maxTokens: -1 }).success).toBe(false);
    expect(evaluatorCreateSchema.safeParse({ ...base, maxTokens: 1.5 }).success).toBe(false);
    expect(evaluatorCreateSchema.safeParse({ ...base, maxTokens: 1 }).success).toBe(true);
  });
});

describe('evaluatorUpdateSchema', () => {
  it('accepts an empty object', () => {
    expect(evaluatorUpdateSchema.safeParse({}).success).toBe(true);
  });
});

describe('evaluatorRunQuerySchema', () => {
  it('enforces a 1-1000 limit bound', () => {
    expect(evaluatorRunQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(evaluatorRunQuerySchema.safeParse({ limit: 1000 }).success).toBe(true);
    expect(evaluatorRunQuerySchema.safeParse({ limit: 1001 }).success).toBe(false);
  });
});

// ── Annotation Queue ────────────────────────────────────────────────────────
describe('annotationQueueCreateSchema', () => {
  it('requires name and scoreConfigId', () => {
    expect(annotationQueueCreateSchema.safeParse({}).success).toBe(false);
  });
  it('accepts an omitted filters object and an empty filters object', () => {
    const base = { name: 'q', scoreConfigId: 'c1', targetType: 'MESSAGE' };
    expect(annotationQueueCreateSchema.safeParse(base).success).toBe(true);
    expect(annotationQueueCreateSchema.safeParse({ ...base, filters: {} }).success).toBe(true);
  });
});

describe('annotationQueueUpdateSchema', () => {
  it('accepts an empty object', () => {
    expect(annotationQueueUpdateSchema.safeParse({}).success).toBe(true);
  });
});

describe('annotationQueuePopulateSchema', () => {
  it('enforces a 1-1000 limit bound', () => {
    expect(annotationQueuePopulateSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(annotationQueuePopulateSchema.safeParse({ limit: 1000 }).success).toBe(true);
    expect(annotationQueuePopulateSchema.safeParse({ limit: 1001 }).success).toBe(false);
  });
});

describe('annotationQueueItemReviewSchema', () => {
  it('defaults status to REVIEWED', () => {
    const r = annotationQueueItemReviewSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe('REVIEWED');
  });
  it('accepts a number, string, or boolean value, and omitted', () => {
    expect(annotationQueueItemReviewSchema.safeParse({ value: 4 }).success).toBe(true);
    expect(annotationQueueItemReviewSchema.safeParse({ value: 'cat' }).success).toBe(true);
    expect(annotationQueueItemReviewSchema.safeParse({ value: true }).success).toBe(true);
  });
  it('rejects an object/array value', () => {
    expect(annotationQueueItemReviewSchema.safeParse({ value: { x: 1 } }).success).toBe(false);
    expect(annotationQueueItemReviewSchema.safeParse({ value: [1] }).success).toBe(false);
  });
});

// ── Experiment ───────────────────────────────────────────────────────────────
describe('experimentCreateSchema', () => {
  it('rejects empty agentVersionIds/scoreConfigIds arrays', () => {
    const base = { name: 'exp', datasetId: 'd1', agentVersionIds: [], scoreConfigIds: ['c1'] };
    expect(experimentCreateSchema.safeParse(base).success).toBe(false);
  });
  it('accepts a minimal valid payload', () => {
    expect(
      experimentCreateSchema.safeParse({ name: 'exp', datasetId: 'd1', agentVersionIds: ['v1'], scoreConfigIds: ['c1'] }).success,
    ).toBe(true);
  });
  it('accepts any plain object for metadata, rejects a non-object', () => {
    const base = { name: 'exp', datasetId: 'd1', agentVersionIds: ['v1'], scoreConfigIds: ['c1'] };
    expect(experimentCreateSchema.safeParse({ ...base, metadata: { any: 'thing' } }).success).toBe(true);
    expect(experimentCreateSchema.safeParse({ ...base, metadata: 'not-an-object' }).success).toBe(false);
  });
});

describe('experimentUpdateSchema', () => {
  it('accepts an empty object', () => {
    expect(experimentUpdateSchema.safeParse({}).success).toBe(true);
  });
});

describe('experimentRunPayloadSchema', () => {
  it('requires both fields', () => {
    expect(experimentRunPayloadSchema.safeParse({}).success).toBe(false);
  });
});

describe('evaluatorRunPayloadSchema', () => {
  it('enforces the same 1-1000 limit bound as evaluatorRunQuerySchema', () => {
    expect(evaluatorRunPayloadSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(evaluatorRunPayloadSchema.safeParse({ limit: 1001 }).success).toBe(false);
  });
});

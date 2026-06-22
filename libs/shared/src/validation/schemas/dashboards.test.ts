import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  widgetLayoutSchema,
  createDashboardSchema,
  updateDashboardSchema,
  createWidgetSchema,
  updateWidgetSchema,
  saveLayoutSchema,
} from './dashboards';

describe('createDashboardSchema', () => {
  it('accepts any 1-100 char name, with or without a <=500 char description', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
        (name, description) => {
          expect(createDashboardSchema.safeParse({ name, description }).success).toBe(true);
        },
      ),
    );
  });

  it('rejects a missing/empty name', () => {
    expect(createDashboardSchema.safeParse({}).success).toBe(false);
    expect(createDashboardSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('accepts a whitespace-only name (schema has no .trim() — documents actual, lenient behavior)', () => {
    expect(createDashboardSchema.safeParse({ name: '   ' }).success).toBe(true);
  });

  it('rejects name over 100 chars, accepts exactly 100', () => {
    expect(createDashboardSchema.safeParse({ name: 'a'.repeat(100) }).success).toBe(true);
    expect(createDashboardSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false);
  });

  it('rejects description over 500 chars, accepts exactly 500', () => {
    expect(createDashboardSchema.safeParse({ name: 'ok', description: 'a'.repeat(500) }).success).toBe(true);
    expect(createDashboardSchema.safeParse({ name: 'ok', description: 'a'.repeat(501) }).success).toBe(false);
  });
});

describe('updateDashboardSchema', () => {
  it('accepts an empty object (every field optional)', () => {
    expect(updateDashboardSchema.safeParse({}).success).toBe(true);
  });
  it('still enforces the 100-char name boundary when name is present', () => {
    expect(updateDashboardSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false);
  });
  it('accepts isDefault as a boolean, rejects a non-boolean', () => {
    expect(updateDashboardSchema.safeParse({ isDefault: true }).success).toBe(true);
    expect(updateDashboardSchema.safeParse({ isDefault: 'yes' }).success).toBe(false);
  });
});

describe('widgetLayoutSchema', () => {
  it('rejects negative x/y, accepts 0', () => {
    expect(widgetLayoutSchema.safeParse({ x: -1, y: 0, w: 1, h: 1 }).success).toBe(false);
    expect(widgetLayoutSchema.safeParse({ x: 0, y: 0, w: 1, h: 1 }).success).toBe(true);
  });
  it('enforces w bounds 1-12', () => {
    expect(widgetLayoutSchema.safeParse({ x: 0, y: 0, w: 0, h: 1 }).success).toBe(false);
    expect(widgetLayoutSchema.safeParse({ x: 0, y: 0, w: 12, h: 1 }).success).toBe(true);
    expect(widgetLayoutSchema.safeParse({ x: 0, y: 0, w: 13, h: 1 }).success).toBe(false);
  });
  it('enforces h bounds 1-20', () => {
    expect(widgetLayoutSchema.safeParse({ x: 0, y: 0, w: 1, h: 0 }).success).toBe(false);
    expect(widgetLayoutSchema.safeParse({ x: 0, y: 0, w: 1, h: 20 }).success).toBe(true);
    expect(widgetLayoutSchema.safeParse({ x: 0, y: 0, w: 1, h: 21 }).success).toBe(false);
  });
  it('rejects non-integer values', () => {
    expect(widgetLayoutSchema.safeParse({ x: 0.5, y: 0, w: 1, h: 1 }).success).toBe(false);
  });
});

const validLayout = { x: 0, y: 0, w: 4, h: 4 };
const validQuerySpec = { source: 'sessions', metric: { key: 'count' }, dateRange: { preset: 'last_30d' }, filters: [], vizType: 'kpi' };

describe('createWidgetSchema', () => {
  it('accepts a valid title + querySpec + layout', () => {
    expect(createWidgetSchema.safeParse({ title: 'My widget', querySpec: validQuerySpec, layout: validLayout }).success).toBe(true);
  });
  it('rejects an invalid nested querySpec', () => {
    expect(createWidgetSchema.safeParse({ title: 'x', querySpec: { source: 'not-a-real-source' }, layout: validLayout }).success).toBe(false);
  });
  it('rejects a missing title', () => {
    expect(createWidgetSchema.safeParse({ querySpec: validQuerySpec, layout: validLayout }).success).toBe(false);
  });
});

describe('updateWidgetSchema', () => {
  it('accepts an empty object (every field optional)', () => {
    expect(updateWidgetSchema.safeParse({}).success).toBe(true);
  });
  it('still enforces the 100-char title boundary when present', () => {
    expect(updateWidgetSchema.safeParse({ title: 'a'.repeat(101) }).success).toBe(false);
  });
});

describe('saveLayoutSchema', () => {
  it('accepts an array of { id, layout } entries', () => {
    expect(saveLayoutSchema.safeParse({ layouts: [{ id: 'w1', layout: validLayout }] }).success).toBe(true);
  });
  it('rejects an entry with an empty id', () => {
    expect(saveLayoutSchema.safeParse({ layouts: [{ id: '', layout: validLayout }] }).success).toBe(false);
  });
  it('accepts an empty layouts array', () => {
    expect(saveLayoutSchema.safeParse({ layouts: [] }).success).toBe(true);
  });
});

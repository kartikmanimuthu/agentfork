import { describe, it, expect } from 'vitest';
import { toolLabel } from './tool-label';

describe('toolLabel', () => {
  it('snake_case → sentence case', () => {
    expect(toolLabel('search_knowledge_base')).toBe('Searching knowledge base');
  });
  it('camelCase → sentence case', () => {
    expect(toolLabel('searchOrders')).toBe('Searching orders');
  });
  it('maps a known verb prefix to its gerund', () => {
    expect(toolLabel('get_account')).toBe('Getting account');
  });
  it('falls back gracefully for an unknown shape', () => {
    expect(toolLabel('foo')).toBe('Running foo');
  });
});

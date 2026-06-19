import { describe, it, expect } from 'vitest';
import { GUARDRAILS_LIB_VERSION } from './index';

describe('guardrails lib smoke', () => {
  it('exports a version constant', () => {
    expect(GUARDRAILS_LIB_VERSION).toBe('0.1.0');
  });
});
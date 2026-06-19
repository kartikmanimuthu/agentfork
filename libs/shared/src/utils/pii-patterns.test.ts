import { describe, it, expect } from 'vitest';
import { processPiiRedaction } from './pii-patterns';

describe('processPiiRedaction', () => {
  it('masks emails', () => {
    expect(processPiiRedaction('Contact me at a@b.com')).toBe('Contact me at [EMAIL]');
  });

  it('masks SSNs', () => {
    expect(processPiiRedaction('ssn 123-45-6789')).toBe('ssn [SSN]');
  });

  it('applies custom patterns', () => {
    expect(processPiiRedaction('ticket PASS1234', ['PASS\\d+'])).toBe('ticket [REDACTED]');
  });

  it('ignores invalid custom patterns (no throw)', () => {
    expect(processPiiRedaction('x', ['['])).toBe('x');
  });
});
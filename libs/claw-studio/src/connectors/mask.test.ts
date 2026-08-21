import { describe, it, expect } from 'vitest';
import { maskSecret } from './mask';

describe('maskSecret', () => {
  it('returns an empty string for absent values so the UI can tell "unset" from "masked"', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret(null)).toBe('');
    expect(maskSecret(undefined)).toBe('');
  });

  it('fully masks values of 8 characters or fewer, revealing nothing about length', () => {
    expect(maskSecret('a')).toBe('********');
    expect(maskSecret('12345678')).toBe('********');
  });

  it('shows the first and last four characters once past the 8-character boundary', () => {
    expect(maskSecret('123456789')).toBe('1234****6789');
    expect(maskSecret('xoxb-abcdefghijklmnop')).toBe('xoxb****mnop');
  });

  it('never returns the input verbatim for a realistic secret', () => {
    const secret = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
    expect(maskSecret(secret)).not.toBe(secret);
    expect(maskSecret(secret)).not.toContain('ABC-DEF');
  });
});

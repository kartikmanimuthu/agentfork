import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ValidationError, parseSearchParams } from './parse-request';

describe('ValidationError', () => {
  it('stores issues and uses first message', () => {
    const error = new ValidationError([
      { message: 'Field is required', path: ['email'], code: 'invalid_type' } as unknown as import('zod').ZodIssue,
    ]);
    expect(error.message).toBe('Field is required');
    expect(error.issues).toHaveLength(1);
    expect(error.name).toBe('ValidationError');
  });

  it('falls back to generic message when no issues', () => {
    const error = new ValidationError([]);
    expect(error.message).toBe('Validation failed');
  });
});

describe('parseSearchParams', () => {
  const schema = z.object({
    conversationId: z.string().min(1, 'conversationId is required'),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });

  it('parses valid URLSearchParams', () => {
    const params = new URLSearchParams({ conversationId: 'conv-123' });
    const result = parseSearchParams(params, schema);
    expect(result.conversationId).toBe('conv-123');
    expect(result.limit).toBe(20);
  });

  it('parses valid record', () => {
    const record = { conversationId: 'conv-123', limit: '50' };
    const result = parseSearchParams(record, schema);
    expect(result.conversationId).toBe('conv-123');
    expect(result.limit).toBe(50);
  });

  it('throws ValidationError on invalid params', () => {
    const params = new URLSearchParams({});
    expect(() => parseSearchParams(params, schema)).toThrow(ValidationError);
  });
});

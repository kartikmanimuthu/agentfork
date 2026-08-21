import { describe, it, expect } from 'vitest';
import { provisionStudioSchema, resetStudioPasswordSchema } from './claw-studio';

describe('claw-studio schemas', () => {
  it('provisionStudioSchema accepts an empty body', () => {
    expect(provisionStudioSchema.safeParse({}).success).toBe(true);
  });
  it('provisionStudioSchema rejects unexpected fields', () => {
    expect(provisionStudioSchema.safeParse({ foo: 1 }).success).toBe(false);
  });
  it('resetStudioPasswordSchema accepts an empty body', () => {
    expect(resetStudioPasswordSchema.safeParse({}).success).toBe(true);
  });
  it('resetStudioPasswordSchema rejects unexpected fields', () => {
    expect(resetStudioPasswordSchema.safeParse({ foo: 1 }).success).toBe(false);
  });
});

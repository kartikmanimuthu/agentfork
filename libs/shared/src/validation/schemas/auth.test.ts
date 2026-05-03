import { describe, it, expect } from 'vitest';
import { signupSchema, loginSchema, profileUpdateSchema } from './auth';

describe('signupSchema', () => {
  it('accepts valid signup data', () => {
    const result = signupSchema.safeParse({ email: 'a@b.com', password: 'password123' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = signupSchema.safeParse({ email: 'not-an-email', password: 'password123' });
    expect(result.success).toBe(false);
  });

  it('rejects short password', () => {
    const result = signupSchema.safeParse({ email: 'a@b.com', password: 'short' });
    expect(result.success).toBe(false);
  });

  it('rejects missing email', () => {
    const result = signupSchema.safeParse({ password: 'password123' });
    expect(result.success).toBe(false);
  });

  it('rejects missing password', () => {
    const result = signupSchema.safeParse({ email: 'a@b.com' });
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('accepts valid login data', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: 'password123' });
    expect(result.success).toBe(true);
  });

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: '' });
    expect(result.success).toBe(false);
  });
});

describe('profileUpdateSchema', () => {
  it('accepts valid profile data', () => {
    const result = profileUpdateSchema.safeParse({
      username: 'john_doe',
      email: 'john@example.com',
      role: 'admin',
    });
    expect(result.success).toBe(true);
  });

  it('accepts profile with optional bio', () => {
    const result = profileUpdateSchema.safeParse({
      username: 'john_doe',
      email: 'john@example.com',
      role: 'admin',
      bio: 'Hello world',
    });
    expect(result.success).toBe(true);
  });

  it('rejects short username', () => {
    const result = profileUpdateSchema.safeParse({
      username: 'j',
      email: 'john@example.com',
      role: 'admin',
    });
    expect(result.success).toBe(false);
  });
});

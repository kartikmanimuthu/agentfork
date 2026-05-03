import { describe, it, expect } from 'vitest';
import { createRoleSchema, updateRoleSchema, updateMemberSchema } from './role';

describe('createRoleSchema', () => {
  it('accepts valid role', () => {
    const result = createRoleSchema.safeParse({
      name: 'Editor',
      permissions: { Conversations: ['read', 'update'] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = createRoleSchema.safeParse({
      name: '',
      permissions: { Conversations: ['read'] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects role with no permissions', () => {
    const result = createRoleSchema.safeParse({
      name: 'Empty',
      permissions: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects role with empty permission arrays', () => {
    const result = createRoleSchema.safeParse({
      name: 'Empty',
      permissions: { Conversations: [] },
    });
    expect(result.success).toBe(false);
  });
});

describe('updateRoleSchema', () => {
  it('accepts valid update', () => {
    const result = updateRoleSchema.safeParse({
      id: 'role-123',
      name: 'Editor',
      permissions: { Conversations: ['read'] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    const result = updateRoleSchema.safeParse({
      name: 'Editor',
      permissions: { Conversations: ['read'] },
    });
    expect(result.success).toBe(false);
  });
});

describe('updateMemberSchema', () => {
  it('accepts valid member update', () => {
    const result = updateMemberSchema.safeParse({ userId: 'user-123', role: 'admin' });
    expect(result.success).toBe(true);
  });

  it('rejects missing userId', () => {
    const result = updateMemberSchema.safeParse({ role: 'admin' });
    expect(result.success).toBe(false);
  });
});

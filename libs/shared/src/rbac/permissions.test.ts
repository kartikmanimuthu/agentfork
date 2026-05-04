import { describe, it, expect } from 'vitest';
import { hasPermission, hasCustomPermission, ROLE_PERMISSIONS, ROLE_LEVELS } from './permissions';
import type { PermissionSet } from './types';

describe('ROLE_PERMISSIONS', () => {
  it('defines all four roles', () => {
    expect(Object.keys(ROLE_PERMISSIONS)).toEqual(['Owner', 'Admin', 'Member', 'Viewer']);
  });

  it('Owner has full CRUD on all modules', () => {
    const owner = ROLE_PERMISSIONS.Owner;
    expect(owner.Conversations).toEqual(['create', 'read', 'update', 'delete']);
    expect(owner.Messages).toEqual(['create', 'read', 'update', 'delete']);
    expect(owner.Settings).toEqual(['create', 'read', 'update', 'delete']);
    expect(owner.Users).toEqual(['create', 'read', 'update', 'delete']);
    expect(owner.Tenants).toEqual(['create', 'read', 'update', 'delete']);
    expect(owner.Agents).toEqual(['create', 'read', 'update', 'delete']);
  });

  it('Viewer has read-only on all modules', () => {
    const viewer = ROLE_PERMISSIONS.Viewer;
    expect(viewer.Conversations).toEqual(['read']);
    expect(viewer.Messages).toEqual(['read']);
    expect(viewer.Settings).toEqual(['read']);
    expect(viewer.Users).toEqual(['read']);
    expect(viewer.Tenants).toEqual(['read']);
    expect(viewer.Agents).toEqual(['read']);
  });

  it('Admin cannot delete Settings', () => {
    expect(ROLE_PERMISSIONS.Admin.Settings).not.toContain('delete');
  });

  it('Member can create and read Conversations but not delete', () => {
    expect(ROLE_PERMISSIONS.Member.Conversations).toEqual(['create', 'read', 'update']);
  });
});

describe('ROLE_LEVELS', () => {
  it('Owner is highest level (4)', () => {
    expect(ROLE_LEVELS.Owner).toBe(4);
  });

  it('Viewer is lowest level (1)', () => {
    expect(ROLE_LEVELS.Viewer).toBe(1);
  });

  it('levels are ordered Owner > Admin > Member > Viewer', () => {
    expect(ROLE_LEVELS.Owner).toBeGreaterThan(ROLE_LEVELS.Admin);
    expect(ROLE_LEVELS.Admin).toBeGreaterThan(ROLE_LEVELS.Member);
    expect(ROLE_LEVELS.Member).toBeGreaterThan(ROLE_LEVELS.Viewer);
  });
});

describe('hasPermission', () => {
  it('returns true when role has the action on the module', () => {
    expect(hasPermission('Owner', 'delete', 'Settings')).toBe(true);
  });

  it('returns false when role lacks the action', () => {
    expect(hasPermission('Viewer', 'create', 'Conversations')).toBe(false);
  });

  it('returns false for an unknown role', () => {
    expect(hasPermission('Unknown' as any, 'read', 'Conversations')).toBe(false);
  });

  it('Member can read Settings but not update', () => {
    expect(hasPermission('Member', 'read', 'Settings')).toBe(true);
    expect(hasPermission('Member', 'update', 'Settings')).toBe(false);
  });
});

describe('hasCustomPermission', () => {
  it('returns true when custom set includes the action', () => {
    const custom: PermissionSet = { Conversations: ['read'], Messages: [], Settings: [], Users: [], Tenants: [], Agents: [] };
    expect(hasCustomPermission(custom, 'read', 'Conversations')).toBe(true);
  });

  it('returns false when custom set lacks the action', () => {
    const custom: PermissionSet = { Conversations: ['read'], Messages: [], Settings: [], Users: [], Tenants: [], Agents: [] };
    expect(hasCustomPermission(custom, 'create', 'Conversations')).toBe(false);
  });

  it('returns false for empty module actions', () => {
    const custom: PermissionSet = { Conversations: [], Messages: [], Settings: [], Users: [], Tenants: [], Agents: [] };
    expect(hasCustomPermission(custom, 'read', 'Conversations')).toBe(false);
  });
});

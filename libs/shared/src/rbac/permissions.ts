import type { Module, Action, PredefinedRole, RoleLevel, PermissionSet } from './types';

export const ROLE_PERMISSIONS: Record<PredefinedRole, PermissionSet> = {
  Owner: {
    Chat: ['create', 'read', 'update', 'delete'],
    Conversations: ['create', 'read', 'update', 'delete'],
    Settings: ['create', 'read', 'update', 'delete'],
  },
  Admin: {
    Chat: ['create', 'read', 'update', 'delete'],
    Conversations: ['create', 'read', 'update', 'delete'],
    Settings: ['create', 'read', 'update'],
  },
  Member: {
    Chat: ['create', 'read'],
    Conversations: ['create', 'read'],
    Settings: ['read'],
  },
  Viewer: {
    Chat: ['read'],
    Conversations: ['read'],
    Settings: ['read'],
  },
};

export const ROLE_LEVELS: Record<PredefinedRole, RoleLevel> = {
  Owner: 4,
  Admin: 3,
  Member: 2,
  Viewer: 1,
};

export function hasPermission(role: PredefinedRole, action: Action, module: Module): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return perms[module]?.includes(action) ?? false;
}

export function hasCustomPermission(permissions: PermissionSet, action: Action, module: Module): boolean {
  return permissions[module]?.includes(action) ?? false;
}

import type { Module, Action, PredefinedRole, RoleLevel, PermissionSet } from './types';

export const ROLE_PERMISSIONS: Record<PredefinedRole, PermissionSet> = {
  Owner: {
    Conversations: ['create', 'read', 'update', 'delete'],
    Messages: ['create', 'read', 'update', 'delete'],
    Settings: ['create', 'read', 'update', 'delete'],
    Users: ['create', 'read', 'update', 'delete'],
    Tenants: ['create', 'read', 'update', 'delete'],
    Agents: ['create', 'read', 'update', 'delete'],
  },
  Admin: {
    Conversations: ['create', 'read', 'update', 'delete'],
    Messages: ['create', 'read', 'update', 'delete'],
    Settings: ['create', 'read', 'update'],
    Users: ['create', 'read', 'update', 'delete'],
    Tenants: ['create', 'read', 'update', 'delete'],
    Agents: ['create', 'read', 'update', 'delete'],
  },
  Member: {
    Conversations: ['create', 'read', 'update'],
    Messages: ['create', 'read', 'update'],
    Settings: ['read'],
    Users: ['read'],
    Tenants: ['read'],
    Agents: ['create', 'read', 'update'],
  },
  Viewer: {
    Conversations: ['read'],
    Messages: ['read'],
    Settings: ['read'],
    Users: ['read'],
    Tenants: ['read'],
    Agents: ['read'],
  },
};

export const ROLE_LEVELS: Record<PredefinedRole, RoleLevel> = {
  Owner: 4,
  Admin: 3,
  Member: 2,
  Viewer: 1,
};

const MIN_ASSIGN_LEVEL: RoleLevel = 3;

export function hasPermission(role: PredefinedRole, action: Action, module: Module): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return perms[module]?.includes(action) ?? false;
}

export function hasCustomPermission(permissions: PermissionSet, action: Action, module: Module): boolean {
  return permissions[module]?.includes(action) ?? false;
}

export function canAssignRole(assignerRole: PredefinedRole, targetRole: PredefinedRole): boolean {
  const assignerLevel = ROLE_LEVELS[assignerRole];
  const targetLevel = ROLE_LEVELS[targetRole];
  if (assignerLevel < MIN_ASSIGN_LEVEL) return false;
  return assignerLevel >= targetLevel;
}

export function getAutoLevel(permissions: PermissionSet): RoleLevel {
  const totalActions = Object.values(permissions).flat().length;
  const maxPossible = 24; // 6 modules * 4 actions
  if (totalActions >= maxPossible) return 4;
  if (totalActions >= 18) return 3;
  if (totalActions >= 10) return 2;
  return 1;
}

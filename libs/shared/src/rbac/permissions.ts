import type { Module, Action, PredefinedRole, RoleLevel, PermissionSet } from './types';

export const ROLE_PERMISSIONS: Record<PredefinedRole, PermissionSet> = {
  Owner: {
    Settings: ['create', 'read', 'update', 'delete'],
    Users: ['create', 'read', 'update', 'delete'],
    Tenants: ['create', 'read', 'update', 'delete'],
    Agents: ['create', 'read', 'update', 'delete'],
    KnowledgeBases: ['create', 'read', 'update', 'delete'],
    McpServers: ['create', 'read', 'update', 'delete'],
    LlmProviders: ['create', 'read', 'update', 'delete'],
  },
  Admin: {
    Settings: ['create', 'read', 'update'],
    Users: ['create', 'read', 'update', 'delete'],
    Tenants: ['create', 'read', 'update', 'delete'],
    Agents: ['create', 'read', 'update', 'delete'],
    KnowledgeBases: ['create', 'read', 'update', 'delete'],
    McpServers: ['create', 'read', 'update', 'delete'],
    LlmProviders: ['create', 'read', 'update', 'delete'],
  },
  Member: {
    Settings: ['read'],
    Users: ['read'],
    Tenants: ['read'],
    Agents: ['create', 'read', 'update'],
    KnowledgeBases: ['create', 'read', 'update'],
    McpServers: ['create', 'read', 'update'],
    LlmProviders: ['create', 'read', 'update'],
  },
  Viewer: {
    Settings: ['read'],
    Users: ['read'],
    Tenants: ['read'],
    Agents: ['read'],
    KnowledgeBases: ['read'],
    McpServers: ['read'],
    LlmProviders: ['read'],
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
  const maxPossible = 28; // 7 modules * 4 actions
  if (totalActions >= maxPossible) return 4;
  if (totalActions >= 19) return 3;
  if (totalActions >= 11) return 2;
  return 1;
}

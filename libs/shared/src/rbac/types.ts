export type Module = 'Chat' | 'Conversations' | 'Settings';
export type Action = 'create' | 'read' | 'update' | 'delete';
export type PredefinedRole = 'Owner' | 'Admin' | 'Member' | 'Viewer';
export type RoleLevel = 1 | 2 | 3 | 4;
export type PermissionSet = Record<Module, Action[]>;

export const SUBJECT_TO_MODULE: Record<string, Module> = {
  Chat: 'Chat',
  Conversation: 'Conversations',
  Setting: 'Settings',
  Tenant: 'Settings',
  User: 'Settings',
  Role: 'Settings',
  AuditLog: 'Conversations',
};

export const ACTION_MAP: Record<string, Action | Action[]> = {
  manage: ['create', 'read', 'update', 'delete'],
  create: 'create',
  read: 'read',
  update: 'update',
  delete: 'delete',
};

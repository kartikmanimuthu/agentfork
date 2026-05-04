export type Module = 'Conversations' | 'Messages' | 'Settings' | 'Users' | 'Tenants' | 'Agents';

export type Action = 'create' | 'read' | 'update' | 'delete';

export type PredefinedRole = 'Owner' | 'Admin' | 'Member' | 'Viewer';

export type RoleLevel = 1 | 2 | 3 | 4;

export type PermissionSet = Record<Module, Action[]>;

export const SUBJECT_TO_MODULE: Record<string, Module> = {
  Conversation: 'Conversations',
  Message: 'Messages',
  User: 'Users',
  Role: 'Users',
  Tenant: 'Tenants',
  Settings: 'Settings',
  all: 'Settings',
  Agent: 'Agents',
  AgentVersion: 'Agents',
  AgentExecution: 'Agents',
};

export const ACTION_MAP: Record<string, Action | Action[]> = {
  manage: ['create', 'read', 'update', 'delete'],
  create: 'create',
  read: 'read',
  update: 'update',
  delete: 'delete',
};

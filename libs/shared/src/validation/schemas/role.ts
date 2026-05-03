import { z } from 'zod';

const actionArraySchema = z.array(z.enum(['create', 'read', 'update', 'delete'])).default([]);

const permissionSetSchema = z.object({
  Conversations: actionArraySchema,
  Messages: actionArraySchema,
  Settings: actionArraySchema,
  Users: actionArraySchema,
  Tenants: actionArraySchema,
}).refine(
  (p) => Object.values(p).flat().length > 0,
  { message: 'At least one permission is required' }
);

export const createRoleSchema = z.object({
  name: z.string().min(1, 'Role name is required').max(50),
  permissions: permissionSetSchema,
});

export const updateRoleSchema = z.object({
  id: z.string().min(1, 'Role ID is required'),
  name: z.string().min(1).max(50),
  permissions: permissionSetSchema,
});

export const roleIdQuerySchema = z.object({
  id: z.string().min(1, 'Role ID is required'),
});

export const updateMemberSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  role: z.string().min(1, 'role is required'),
});

export const memberIdQuerySchema = z.object({
  userId: z.string().min(1, 'userId is required'),
});

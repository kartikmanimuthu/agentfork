import { z } from 'zod';

export const slugSchema = z
  .string()
  .min(3, 'Slug must be at least 3 characters')
  .max(50, 'Slug must be at most 50 characters')
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Slug must be lowercase letters, numbers, or hyphens');

export const createTenantSchema = z.object({
  name: z.string().min(1, 'Organization name is required').max(100),
  slug: slugSchema,
});

export const updateTenantSettingsSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().optional(),
  notifications: z.object({
    scheduleExecutions: z.boolean().optional(),
    memberInvites: z.boolean().optional(),
    systemAlerts: z.boolean().optional(),
  }).optional(),
});

export const tenantSwitchSchema = z.object({
  tenantId: z.string().min(1, 'tenantId is required'),
});

export const checkSlugQuerySchema = z.object({
  slug: slugSchema,
});

import { z } from 'zod';
import { widgetQuerySpecSchema } from '../../dashboards/widget-query-spec';

export const widgetLayoutSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20),
});

export const createDashboardSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
});

export const updateDashboardSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
});

export const createWidgetSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100),
  querySpec: widgetQuerySpecSchema,
  layout: widgetLayoutSchema,
});

export const updateWidgetSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  querySpec: widgetQuerySpecSchema.optional(),
  layout: widgetLayoutSchema.optional(),
});

export const saveLayoutSchema = z.object({
  layouts: z.array(z.object({ id: z.string().min(1), layout: widgetLayoutSchema })),
});

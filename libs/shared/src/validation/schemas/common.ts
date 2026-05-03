import { z } from 'zod';

export const idParamSchema = z.string().min(1, 'ID is required');

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

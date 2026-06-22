import { z } from 'zod';
import { vizTypeSchema, vizConfigSchema, MAX_SQL_LENGTH } from '../../reports/report-viz';

const sqlTextSchema = z
  .string()
  .trim()
  .min(1, 'SQL query is required')
  .max(MAX_SQL_LENGTH, `SQL query must be at most ${MAX_SQL_LENGTH} characters`);

export const runReportSchema = z.object({
  sql: sqlTextSchema,
});

export const createReportSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  sqlText: sqlTextSchema,
  vizType: vizTypeSchema.default('table'),
  vizConfig: vizConfigSchema.default({ yKeys: [] }),
});

export const updateReportSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  sqlText: sqlTextSchema.optional(),
  vizType: vizTypeSchema.optional(),
  vizConfig: vizConfigSchema.optional(),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;
export type UpdateReportInput = z.infer<typeof updateReportSchema>;
export type RunReportInput = z.infer<typeof runReportSchema>;

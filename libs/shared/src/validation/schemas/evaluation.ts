import { z } from 'zod';

export const scoreDataTypeSchema = z.enum(['NUMERIC', 'CATEGORICAL', 'BOOLEAN']);
export const scoreTargetTypeSchema = z.enum(['MESSAGE', 'SESSION']);
const scoreCategorySchema = z.object({ label: z.string().min(1), value: z.number() });

const scoreConfigBase = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  dataType: scoreDataTypeSchema,
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  categories: z.array(scoreCategorySchema).optional(),
});

const refineConfig = (s: z.infer<typeof scoreConfigBase>, ctx: z.RefinementCtx) => {
  if (s.dataType === 'NUMERIC' && s.minValue != null && s.maxValue != null && s.minValue >= s.maxValue) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'minValue must be < maxValue', path: ['minValue'] });
  }
  if (s.dataType === 'CATEGORICAL' && (!s.categories || s.categories.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CATEGORICAL requires at least one category', path: ['categories'] });
  }
};

export const scoreConfigCreateSchema = scoreConfigBase.superRefine(refineConfig);
export const scoreConfigUpdateSchema = scoreConfigBase.partial().extend({
  name: z.string().min(1).max(100).optional(),
  isArchived: z.boolean().optional(),
});

const scoreValueSchema = z.union([z.number(), z.string(), z.boolean()]);

export const scoreManualCreateSchema = z.object({
  configId: z.string().min(1),
  targetType: scoreTargetTypeSchema,
  targetId: z.string().min(1),
  value: scoreValueSchema,
  comment: z.string().max(1000).optional(),
});

export const scoreIngestSchema = scoreManualCreateSchema; // same shape; auth differs

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional();

export const scoreListQuerySchema = z.object({
  configId: z.string().optional(),
  targetType: scoreTargetTypeSchema.optional(),
  sessionId: z.string().optional(),
  messageId: z.string().optional(),
  source: z.enum(['ANNOTATION', 'API']).optional(),
  fromDate: isoDateSchema,
  toDate: isoDateSchema,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const datasetCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  metadata: z.unknown().optional(),
});
export const datasetUpdateSchema = datasetCreateSchema.partial();

export const datasetItemCreateSchema = z.object({
  input: z.unknown().refine((v) => v !== undefined && v !== null, 'input is required'),
  expectedOutput: z.unknown().optional(),
  metadata: z.unknown().optional(),
});
export const datasetItemBulkSchema = z.object({ items: z.array(datasetItemCreateSchema).min(1).max(1000) });

export const addFromTraceSchema = z.object({
  targetType: scoreTargetTypeSchema,
  targetId: z.string().min(1),
});

export type ScoreConfigCreate = z.infer<typeof scoreConfigCreateSchema>;
export type ScoreManualCreate = z.infer<typeof scoreManualCreateSchema>;
export type ScoreIngest = z.infer<typeof scoreIngestSchema>;
export type DatasetCreate = z.infer<typeof datasetCreateSchema>;
export type DatasetItemCreate = z.infer<typeof datasetItemCreateSchema>;

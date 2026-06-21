import { z } from 'zod';

export const scoreDataTypeSchema = z.enum(['NUMERIC', 'CATEGORICAL', 'BOOLEAN']);
export const scoreTargetTypeSchema = z.enum(['MESSAGE', 'SESSION', 'EXECUTION']);
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

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((v) => !isNaN(new Date(v).getTime()), 'Invalid date')
  .optional();

export const scoreListQuerySchema = z.object({
  configId: z.string().optional(),
  targetType: scoreTargetTypeSchema.optional(),
  sessionId: z.string().optional(),
  messageId: z.string().optional(),
  executionId: z.string().optional(),
  source: z.enum(['ANNOTATION', 'API', 'EVALUATOR']).optional(),
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

export const datasetExportFormatSchema = z
  .enum(['jsonl', 'json', 'openai', 'prompt-completion', 'anthropic', 'csv'])
  .default('jsonl');

// ── Evaluator ───────────────────────────────────────────────────────────────
export const evaluatorCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  scoreConfigId: z.string().min(1),
  prompt: z.string().min(1).max(20000),
  model: z.string().max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

export const evaluatorUpdateSchema = evaluatorCreateSchema.partial().extend({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

export const evaluatorRunQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

// ── Annotation Queue ────────────────────────────────────────────────────────
export const annotationQueueCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  scoreConfigId: z.string().min(1),
  targetType: scoreTargetTypeSchema,
  filters: z
    .object({
      sessionIds: z.array(z.string()).optional(),
      messageIds: z.array(z.string()).optional(),
      executionIds: z.array(z.string()).optional(),
      dateRange: z.object({ from: isoDateSchema, to: isoDateSchema }).optional(),
    })
    .optional(),
});

export const annotationQueueUpdateSchema = annotationQueueCreateSchema.partial().extend({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

export const annotationQueuePopulateSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export const annotationQueueItemReviewSchema = z.object({
  value: scoreValueSchema.optional(),
  comment: z.string().max(1000).optional(),
  status: z.enum(['REVIEWED', 'SKIPPED']).default('REVIEWED'),
});

// ── Experiment ────────────────────────────────────────────────────────────────
export const experimentCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  datasetId: z.string().min(1),
  agentVersionIds: z.array(z.string().min(1)).min(1),
  scoreConfigIds: z.array(z.string().min(1)).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const experimentUpdateSchema = experimentCreateSchema.partial();

export const experimentRunPayloadSchema = z.object({
  experimentId: z.string().min(1),
  tenantId: z.string().min(1),
});

export const evaluatorRunPayloadSchema = z.object({
  evaluatorId: z.string().min(1),
  tenantId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export type ScoreConfigCreate = z.infer<typeof scoreConfigCreateSchema>;
export type ScoreManualCreate = z.infer<typeof scoreManualCreateSchema>;
export type ScoreIngest = z.infer<typeof scoreIngestSchema>;
export type DatasetCreate = z.infer<typeof datasetCreateSchema>;
export type DatasetItemCreate = z.infer<typeof datasetItemCreateSchema>;
export type EvaluatorCreate = z.infer<typeof evaluatorCreateSchema>;
export type EvaluatorUpdate = z.infer<typeof evaluatorUpdateSchema>;
export type AnnotationQueueCreate = z.infer<typeof annotationQueueCreateSchema>;
export type AnnotationQueueUpdate = z.infer<typeof annotationQueueUpdateSchema>;
export type AnnotationQueuePopulate = z.infer<typeof annotationQueuePopulateSchema>;
export type AnnotationQueueItemReview = z.infer<typeof annotationQueueItemReviewSchema>;
export type ExperimentCreate = z.infer<typeof experimentCreateSchema>;
export type ExperimentUpdate = z.infer<typeof experimentUpdateSchema>;

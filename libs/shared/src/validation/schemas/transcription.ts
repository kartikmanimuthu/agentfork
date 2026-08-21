import { z } from 'zod';

// ─── Transcription model (engine endpoint) ────────────────────────────────────
// The tenant registers their self-hosted speech-to-text model. `credentials` is an
// open string map (e.g. { authHeader, token, apiKey }) encrypted at rest.
export const transcriptionCredentialsSchema = z.record(z.string(), z.string());

export const transcriptionProviderTypeSchema = z.enum([
  'CUSTOM',
  'VLLM',
  'OPENAI_COMPATIBLE',
  'LITELLM',
]);
export const transcriptionContractSchema = z.enum(['custom', 'openai-audio']);

export const createTranscriptionModelSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  providerType: transcriptionProviderTypeSchema.optional(),
  contract: transcriptionContractSchema.optional(),
  endpointUrl: z.string().url('A valid endpoint URL is required').optional(),
  credentials: transcriptionCredentialsSchema.optional(),
  region: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  models: z
    .array(z.object({ id: z.string(), name: z.string(), capabilities: z.array(z.string()) }))
    .optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
});

export const updateTranscriptionModelSchema = createTranscriptionModelSchema.partial().extend({
  credentials: transcriptionCredentialsSchema.optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

// Validate-and-discover (scan/list models) input — mirrors LLM provider validate.
export const validateTranscriptionModelSchema = z.object({
  providerType: transcriptionProviderTypeSchema,
  endpointUrl: z.string().url().optional(),
  credentials: transcriptionCredentialsSchema.optional(),
  region: z.string().min(1).optional(),
});

// Version snapshot creation.
export const createTranscriptionModelVersionSchema = z.object({
  changeNotes: z.string().max(500).optional(),
});

// ─── Transcription API key ────────────────────────────────────────────────────
export const createTranscriptionApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  jobConfigId: z.string().optional(),
  modelId: z.string().optional(),
  dailyReqLimit: z.number().int().min(0).optional(),
  dailyMinutesLimit: z.number().int().min(0).optional(),
  minuteReqLimit: z.number().int().min(0).optional(),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
  webhookUrl: z.string().url().optional(),
  webhookSecret: z.string().optional(),
});

export const createTranscriptionJobConfigSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  modelId: z.string().optional(),
  versionId: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const updateTranscriptionJobConfigSchema = createTranscriptionJobConfigSchema.partial().extend({
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

export const createTranscriptionJobVersionSchema = z.object({
  changeNotes: z.string().max(500).optional(),
});

// ─── External transcription request (POST /api/v1/transcription) ──────────────
// Two input modes: upload-ref (audio in OUR bucket) or inline payload (base64/multipart).
// `sync: true` (default) blocks and returns the transcript immediately.
// `sync: false` enqueues a background job and returns a job id for polling.
const commonRequestFields = {
  language: z.string().min(2).max(16).optional(),
  webhookUrl: z.string().url().optional(),
  sync: z.boolean().optional(),
  modelId: z.string().optional(),
  versionId: z.string().optional(),
  diarize: z.boolean().optional(),
};

// Primary two-API flow: audio already uploaded to OUR bucket via the Upload API,
// referenced by its tenant-scoped s3Key (or the presigned s3Url the upload returned).
export const transcriptionUploadRefRequestSchema = z.object({
  s3Key: z.string().min(1).optional(),
  s3Url: z.string().url().optional(),
  ...commonRequestFields,
}).refine((d) => Boolean(d.s3Key || d.s3Url), { message: 's3Key or s3Url is required' });

export const transcriptionPayloadRequestSchema = z.object({
  source: z.literal('payload').optional(),
  audio: z.string().min(1, 'Base64 audio is required'),
  mimeType: z.string().min(1, 'mimeType is required'),
  fileName: z.string().optional(),
  ...commonRequestFields,
});

// Reference an upload minted by POST /api/v1/transcription/uploads. Preferred shape —
// the caller holds one short, opaque id from presign through webhook to retrieval.
export const transcriptionUploadIdRequestSchema = z.object({
  uploadId: z.string().min(1),
  ...commonRequestFields,
});

export const transcriptionRequestSchema = z.union([
  transcriptionUploadIdRequestSchema,
  transcriptionPayloadRequestSchema,
  transcriptionUploadRefRequestSchema,
]);

/**
 * Audio container types the Upload API will presign for. The declared value is pinned into
 * the POST policy, so S3 rejects an upload whose Content-Type header differs — but S3 never
 * inspects the bytes, so the real format is verified from magic bytes at transcribe time.
 */
export const TRANSCRIPTION_ALLOWED_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/mpeg3',
  'audio/x-mpeg-3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/vnd.wave',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/amr',
  'audio/amr-wb',
] as const;

export const createTranscriptionUploadSchema = z.object({
  fileName: z.string().min(1).max(255).optional(),
  mimeType: z
    .string()
    .min(1)
    .refine((v) => (TRANSCRIPTION_ALLOWED_MIME_TYPES as readonly string[]).includes(v.toLowerCase()), {
      message: `mimeType must be one of: ${TRANSCRIPTION_ALLOWED_MIME_TYPES.join(', ')}`,
    }),
  clientReference: z.string().min(1).max(255).optional(),
  declaredSizeBytes: z.coerce.number().int().positive().optional(),
  expiresInSeconds: z.coerce.number().int().min(300).max(3600).optional(),
});

export const getTranscriptQuerySchema = z
  .object({
    uploadId: z.string().min(1).optional(),
    transcriptionId: z.string().min(1).optional(),
  })
  .refine((d) => Boolean(d.uploadId) !== Boolean(d.transcriptionId), {
    message: 'Provide exactly one of uploadId or transcriptionId',
  });

export type CreateTranscriptionModelInput = z.infer<typeof createTranscriptionModelSchema>;
export type UpdateTranscriptionModelInput = z.infer<typeof updateTranscriptionModelSchema>;
export type ValidateTranscriptionModelInput = z.infer<typeof validateTranscriptionModelSchema>;
export type CreateTranscriptionModelVersionInput = z.infer<typeof createTranscriptionModelVersionSchema>;
export type CreateTranscriptionApiKeyInput = z.infer<typeof createTranscriptionApiKeySchema>;
export type TranscriptionRequestInput = z.infer<typeof transcriptionRequestSchema>;
export type TranscriptionProviderType = z.infer<typeof transcriptionProviderTypeSchema>;
export type TranscriptionContractType = z.infer<typeof transcriptionContractSchema>;

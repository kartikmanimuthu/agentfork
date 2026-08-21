import { z } from 'zod';

// Provision and reset take no request body — the tenant comes from the session.
export const provisionStudioSchema = z.object({}).strict();
export const resetStudioPasswordSchema = z.object({}).strict();

export type ProvisionStudioInput = z.infer<typeof provisionStudioSchema>;
export type ResetStudioPasswordInput = z.infer<typeof resetStudioPasswordSchema>;

import { z } from 'zod';

export class ValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    super(issues[0]?.message ?? 'Validation failed');
    this.name = 'ValidationError';
  }
}

export async function parseJson<T>(request: Request, schema: z.ZodSchema<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error('Invalid JSON body');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues);
  return parsed.data;
}

export function parseSearchParams<T>(params: URLSearchParams | Record<string, string>, schema: z.ZodSchema<T>): T {
  const obj = params instanceof URLSearchParams ? Object.fromEntries(params) : params;
  const parsed = schema.safeParse(obj);
  if (!parsed.success) throw new ValidationError(parsed.error.issues);
  return parsed.data;
}

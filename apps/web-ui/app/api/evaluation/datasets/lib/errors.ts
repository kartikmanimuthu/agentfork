import { NextResponse } from 'next/server';
import { createLogger, ValidationError } from '@chatbot/shared';

// shared error helper used by all evaluation dataset routes
export function evalError(error: unknown, log: ReturnType<typeof createLogger>, action: string): NextResponse {
  if (error instanceof ValidationError) return NextResponse.json({ error: 'Validation failed', issues: error.issues }, { status: 422 });
  if (error instanceof Error && error.message.includes('Unauthenticated')) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (error instanceof Error && /not found/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 404 });
  log.error({ err: error, action }, `Failed to ${action}`);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

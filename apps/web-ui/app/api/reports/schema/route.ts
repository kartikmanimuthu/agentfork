import { NextResponse } from 'next/server';
import {
  getSessionTenantId,
  authorize,
  getPrismaClient,
  ReportSchemaService,
  createLogger,
} from '@chatbot/shared';
import type { ReportSchemaDb } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:reports:schema');

export async function GET() {
  try {
    // tenant scoping not needed for metadata, but require an authenticated tenant.
    await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Report', authOptions);
    if (authError) return authError;

    const schemaService = new ReportSchemaService(getPrismaClient() as unknown as ReportSchemaDb);
    const tables = await schemaService.introspect();
    return NextResponse.json({ tables });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json({ error: 'Unauthorized', message: error.message }, { status: 403 });
    }
    logger.error({ err: error }, 'Failed to load report schema');
    return NextResponse.json(
      { error: { type: 'internal_error', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}

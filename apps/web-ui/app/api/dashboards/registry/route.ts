import { NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getRegistryMeta, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const logger = createLogger('api:dashboards:registry');

export async function GET() {
  try {
    await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Dashboard', authOptions);
    if (authError) return authError;
    return NextResponse.json({ sources: getRegistryMeta() });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json(
        { error: 'Unauthorized', message: error.message },
        { status: 403 },
      );
    }
    logger.error({ err: error }, 'Failed to load dashboard registry');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}

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
    logger.error({ err: error }, 'Failed to load dashboard registry');
    return NextResponse.json({ error: { type: 'internal_error', message: 'Internal server error' } }, { status: 500 });
  }
}

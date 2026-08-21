import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import {
  getIntegrationDescriptor,
  IntegrationConfigService,
  ConnectorEncryptionUnavailableError,
} from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:integrations:test');

// Either a candidate (not-yet-saved) field set for a brand new account, or an
// existing accountId plus optional field overrides layered on top of what's
// already stored — nothing here is ever persisted.
const bodySchema = z.object({
  accountId: z.string().optional(),
  overrides: z.record(z.string(), z.string()).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ integration: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }

    const { integration } = await params;
    const descriptor = getIntegrationDescriptor(integration);
    if (!descriptor) {
      return NextResponse.json({ success: false, error: 'Unknown integration' }, { status: 404 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid input' }, { status: 400 });
    }
    const { accountId, overrides = {} } = parsed.data;

    let fields: Record<string, string> = overrides;
    if (accountId) {
      const configs = new IntegrationConfigService(session.studio.tenantId, descriptor);
      // OAuth accounts go through resolveAccount() so a near-expiry token is
      // transparently refreshed before testing — getRawAccount() alone would
      // report "connection failed" on a token that a real tool call would
      // have silently refreshed.
      const stored =
        descriptor.authMode === 'oauth'
          ? (await configs.resolveAccount(accountId))?.raw
          : await configs.getRawAccount(accountId);
      if (!stored) {
        return NextResponse.json({ success: false, error: 'Account not found' }, { status: 404 });
      }
      fields = { ...(stored as Record<string, string>), ...overrides };
    }

    const result = await descriptor.verify(fields);

    // A rejected credential is a valid answer to "does this work?", so it's a
    // 200 with success:false rather than an HTTP error.
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error });
    }
    return NextResponse.json({ success: true, data: { detail: result.detail, ...(result.meta ?? {}) } });
  } catch (error) {
    if (error instanceof ConnectorEncryptionUnavailableError) {
      logger.error({ error }, 'Integration test failed — encryption unavailable');
      return NextResponse.json({ success: false, error: error.message }, { status: 503 });
    }
    logger.error({ error }, 'Integration test failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

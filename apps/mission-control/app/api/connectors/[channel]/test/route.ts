import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { createLogger } from '@chatbot/shared';
import {
  getConnectorRegistry,
  ConnectorEncryptionUnavailableError,
  type ChannelType,
} from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:connectors:test');

// Any not-yet-saved token typed into the form. Nothing here is persisted.
const bodySchema = z.record(z.string(), z.string()).optional();

export async function POST(request: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }

    const { channel } = await params;
    const registry = getConnectorRegistry();
    if (!registry.has(channel)) {
      return NextResponse.json({ success: false, error: 'Unknown connector' }, { status: 404 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid input' }, { status: 400 });
    }

    const result = await registry
      .get(channel as ChannelType)
      .verifyCredentials(session.studio.tenantId, parsed.data ?? {});

    // A rejected credential is a valid answer to "does this work?", so it's a
    // 200 with success:false rather than an HTTP error.
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error });
    }
    return NextResponse.json({ success: true, data: { detail: result.detail, ...(result.meta ?? {}) } });
  } catch (error) {
    if (error instanceof ConnectorEncryptionUnavailableError) {
      logger.error({ error }, 'Connector test failed — encryption unavailable');
      return NextResponse.json({ success: false, error: error.message }, { status: 503 });
    }
    logger.error({ error }, 'Connector test failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

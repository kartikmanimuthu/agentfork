import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createLogger } from '@chatbot/shared';
import { getConnectorRegistry, ClawConnectorConfigService } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:connectors');

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    const tenantId = session.studio.tenantId;
    const configs = new ClawConnectorConfigService(tenantId);

    const connectors = await Promise.all(
      getConnectorRegistry().list().map(async (connector) => {
        // One unreadable channel must not blank the whole page — degrade that
        // card to "not configured" and keep the rest of the list intact.
        let configured = false;
        let enabled = false;
        try {
          const masked = await configs.getMasked(connector.channelType);
          configured = masked.configured;
          enabled = masked.enabled;
        } catch (error) {
          logger.error(
            { error, tenantId, channel: connector.channelType },
            'Failed to read connector status — reporting as not configured',
          );
        }

        return {
          channel: connector.channelType,
          displayName: connector.displayName,
          description: connector.description,
          deliveryMode: connector.deliveryMode,
          hilCapabilities: connector.hilCapabilities,
          configured,
          enabled,
        };
      }),
    );

    return NextResponse.json({ success: true, connectors });
  } catch (error) {
    logger.error({ error }, 'Failed to list connectors');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

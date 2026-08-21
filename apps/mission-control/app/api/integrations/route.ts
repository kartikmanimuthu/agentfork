import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createLogger } from '@chatbot/shared';
import { listIntegrationDescriptors, IntegrationConfigService } from '@chatbot/claw-studio';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:integrations');

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }
    const tenantId = session.studio.tenantId;

    const integrations = await Promise.all(
      listIntegrationDescriptors().map(async (descriptor) => {
        // One unreadable integration must not blank the whole page — degrade
        // that card to "not connected" and keep the rest of the list intact.
        let accountCount = 0;
        try {
          accountCount = (await new IntegrationConfigService(tenantId, descriptor).listAccounts()).length;
        } catch (error) {
          logger.error(
            { error, tenantId, integration: descriptor.name },
            'Failed to read integration account count — reporting as not connected',
          );
        }

        return {
          name: descriptor.name,
          displayName: descriptor.displayName,
          description: descriptor.description,
          accountMode: descriptor.accountMode,
          authMode: descriptor.authMode,
          accountCount,
        };
      }),
    );

    return NextResponse.json({ success: true, integrations });
  } catch (error) {
    logger.error({ error }, 'Failed to list integrations');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

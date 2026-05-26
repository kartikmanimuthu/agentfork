import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger, EncryptionService } from '@chatbot/shared';
import { whatsappEnv } from '@chatbot/whatsapp';
import { authOptions } from '@/lib/auth';

const logger = createLogger('whatsapp-template-sync');

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TenantConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const prisma = getPrismaClient();

    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const encryption = new EncryptionService();
    const accessToken = encryption.decrypt(account.accessToken);

    const response = await fetch(
      `https://graph.facebook.com/${whatsappEnv.META_API_VERSION}/${account.wabaId}/message_templates`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to fetch templates from Meta');
      return NextResponse.json({ error: 'Failed to sync templates from Meta' }, { status: 502 });
    }

    const data = await response.json();
    const metaTemplates = data.data ?? [];

    let synced = 0;
    for (const tmpl of metaTemplates) {
      await (prisma as any).whatsAppTemplate.upsert({
        where: {
          accountId_name_language: {
            accountId: id,
            name: tmpl.name,
            language: tmpl.language,
          },
        },
        update: {
          category: tmpl.category,
          status: tmpl.status,
          components: tmpl.components,
        },
        create: {
          accountId: id,
          name: tmpl.name,
          language: tmpl.language,
          category: tmpl.category,
          status: tmpl.status,
          components: tmpl.components,
        },
      });
      synced++;
    }

    logger.info({ tenantId, accountId: id, synced }, 'Templates synced from Meta');

    return NextResponse.json({ synced });
  } catch (error) {
    logger.error({ error }, 'Error syncing templates');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

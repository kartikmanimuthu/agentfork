import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger, EncryptionService } from '@chatbot/shared';
import { MetaWhatsAppClient, whatsappEnv } from '@chatbot/whatsapp';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('whatsapp-template-send');

const sendTemplateSchema = z.object({
  to: z.string().min(1),
  templateName: z.string().min(1),
  languageCode: z.string().min(1),
  components: z.array(z.object({
    type: z.enum(['header', 'body', 'button']),
    parameters: z.array(z.record(z.unknown())),
    sub_type: z.string().optional(),
    index: z.number().optional(),
  })).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('update', 'TenantConfig', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const body = await req.json();
    const parsed = sendTemplateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const prisma = getPrismaClient();
    const account = await (prisma as any).whatsAppAccount.findFirst({
      where: { id, tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const encryption = new EncryptionService();
    const accessToken = encryption.decrypt(account.accessToken);

    const client = new MetaWhatsAppClient({
      accessToken,
      phoneNumberId: account.phoneNumberId,
      apiVersion: whatsappEnv.META_API_VERSION,
    });

    const result = await client.sendTemplateMessage(
      parsed.data.to,
      parsed.data.templateName,
      parsed.data.languageCode,
      parsed.data.components as any,
    );

    await (prisma as any).whatsAppMessage.create({
      data: {
        accountId: id,
        waMessageId: result.messages[0].id,
        direction: 'outbound',
        contactPhone: parsed.data.to,
        type: 'template',
        content: { templateName: parsed.data.templateName, languageCode: parsed.data.languageCode, components: parsed.data.components },
        status: 'sent',
      },
    });

    logger.info({ tenantId, accountId: id, to: parsed.data.to, template: parsed.data.templateName }, 'Template message sent');

    return NextResponse.json({ messageId: result.messages[0].id });
  } catch (error) {
    logger.error({ error }, 'Error sending template message');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

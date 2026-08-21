import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger, EncryptionService } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('whatsapp-connect-netcore');

const connectNetcoreSchema = z.object({
  displayName: z.string().min(1),
  wabaId: z.string().min(1),
  phoneNumber: z.string().regex(/^\d{10,15}$/, 'Phone number must be digits only, with country code, no + or spaces'),
  apiKey: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'TenantConfig', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = connectNetcoreSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const encryption = new EncryptionService();
    const encryptedApiKey = encryption.encrypt(parsed.data.apiKey);

    const prisma = getPrismaClient();
    const account = await (prisma as any).whatsAppAccount.upsert({
      where: { tenantId_wabaId: { tenantId, wabaId: parsed.data.wabaId } },
      create: {
        tenantId,
        provider: 'netcore',
        wabaId: parsed.data.wabaId,
        phoneNumberId: parsed.data.phoneNumber,
        displayPhone: parsed.data.phoneNumber,
        displayName: parsed.data.displayName,
        accessToken: encryptedApiKey,
        webhookSecret: crypto.randomUUID(),
        status: 'active',
      },
      update: {
        phoneNumberId: parsed.data.phoneNumber,
        displayPhone: parsed.data.phoneNumber,
        displayName: parsed.data.displayName,
        accessToken: encryptedApiKey,
        status: 'active',
      },
    });

    await (prisma as any).whatsAppRouting.upsert({
      where: { accountId: account.id },
      create: {
        accountId: account.id,
        strategy: 'keyword',
        config: {},
        fallbackAgentId: null,
      },
      update: {},
    });

    logger.info({ tenantId, accountId: account.id, phoneNumberId: account.phoneNumberId }, 'Netcore WhatsApp account connected');

    return NextResponse.json({
      id: account.id,
      phoneNumberId: account.phoneNumberId,
      displayPhone: account.displayPhone,
      displayName: account.displayName,
      status: account.status,
    }, { status: 201 });

  } catch (error) {
    logger.error({ error }, 'Error connecting Netcore WhatsApp account');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

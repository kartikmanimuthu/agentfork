import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { EncryptionService } from '@chatbot/shared';
import { whatsappEnv } from '@chatbot/whatsapp';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('whatsapp-connect');

const connectSchema = z.object({
  code: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('create', 'TenantConfig', authOptions);
    if (authError) return authError;

    const body = await req.json();
    const parsed = connectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const tokenResponse = await fetch(
      `https://graph.facebook.com/${whatsappEnv.META_API_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        client_id: whatsappEnv.META_APP_ID,
        client_secret: whatsappEnv.META_APP_SECRET,
        code: parsed.data.code,
      }),
    );

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json();
      logger.error({ error }, 'Failed to exchange code for token');
      return NextResponse.json({ error: 'Failed to connect WhatsApp account' }, { status: 502 });
    }

    const { access_token } = await tokenResponse.json();

    const phonesResponse = await fetch(
      `https://graph.facebook.com/${whatsappEnv.META_API_VERSION}/me/phone_numbers`,
      { headers: { Authorization: `Bearer ${access_token}` } },
    );

    if (!phonesResponse.ok) {
      logger.error('Failed to fetch phone numbers');
      return NextResponse.json({ error: 'Failed to fetch WhatsApp phone numbers' }, { status: 502 });
    }

    const phonesData = await phonesResponse.json();
    const phoneNumber = phonesData.data?.[0];

    if (!phoneNumber) {
      return NextResponse.json({ error: 'No phone number found in WhatsApp Business Account' }, { status: 400 });
    }

    const encryption = new EncryptionService();
    const encryptedToken = encryption.encrypt(access_token);

    const prisma = getPrismaClient();
    const account = await (prisma as any).whatsAppAccount.create({
      data: {
        tenantId,
        wabaId: phoneNumber.waba_id ?? 'pending',
        phoneNumberId: phoneNumber.id,
        displayPhone: phoneNumber.display_phone_number,
        displayName: phoneNumber.verified_name ?? '',
        accessToken: encryptedToken,
        webhookSecret: crypto.randomUUID(),
        status: 'active',
        qualityRating: phoneNumber.quality_rating ?? null,
        messagingLimit: phoneNumber.messaging_limit_tier ?? null,
      },
    });

    await (prisma as any).whatsAppRouting.create({
      data: {
        accountId: account.id,
        strategy: 'keyword',
        config: {},
        fallbackAgentId: null,
      },
    });

    logger.info({ tenantId, accountId: account.id, phoneNumberId: phoneNumber.id }, 'WhatsApp account connected');

    return NextResponse.json({
      id: account.id,
      phoneNumberId: account.phoneNumberId,
      displayPhone: account.displayPhone,
      displayName: account.displayName,
      status: account.status,
    }, { status: 201 });

  } catch (error) {
    logger.error({ error }, 'Error connecting WhatsApp account');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

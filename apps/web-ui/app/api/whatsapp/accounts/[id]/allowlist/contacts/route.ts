import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';
import { z } from 'zod';

const logger = createLogger('whatsapp-allowlist-contacts');

const addContactSchema = z.object({
  phoneNumber: z.string().regex(/^\d{10,15}$/, 'Phone number must be digits only, with country code, no + or spaces'),
  label: z.string().optional(),
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
    const parsed = addContactSchema.safeParse(body);
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

    const contact = await (prisma as any).whatsAppAllowedContact.create({
      data: {
        accountId: id,
        phoneNumber: parsed.data.phoneNumber,
        label: parsed.data.label ?? null,
      },
    });

    logger.info({ tenantId, accountId: id, phoneNumber: parsed.data.phoneNumber }, 'Added WhatsApp allowlist contact');

    return NextResponse.json(contact, { status: 201 });
  } catch (error) {
    if (error instanceof Error && (error as any).code === 'P2002') {
      return NextResponse.json({ error: 'This phone number is already on the allowlist' }, { status: 409 });
    }
    logger.error({ error }, 'Error adding allowlist contact');
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { TenantConfigService, createLogger } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

const logger = createLogger('mission-control:api:studio:notifications');

const CONFIG_KEY = 'studio-notification-prefs';

const prefsSchema = z.object({
  scheduledTaskFailures: z.boolean(),
  approvalRequests: z.boolean(),
  weeklySummary: z.boolean(),
});

export type NotificationPrefs = z.infer<typeof prefsSchema>;

const DEFAULT_PREFS: NotificationPrefs = {
  scheduledTaskFailures: true,
  approvalRequests: true,
  weeklySummary: false,
};

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }

    const stored = await new TenantConfigService(session.studio.tenantId).get<NotificationPrefs>(CONFIG_KEY);
    return NextResponse.json({ success: true, data: { ...DEFAULT_PREFS, ...stored } });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch notification preferences');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.studio?.tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthenticated' }, { status: 401 });
    }

    const parsed = prefsSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    await new TenantConfigService(session.studio.tenantId).set(CONFIG_KEY, parsed.data, session.studio.studioId);
    return NextResponse.json({ success: true, data: parsed.data });
  } catch (error) {
    logger.error({ error }, 'Failed to save notification preferences');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

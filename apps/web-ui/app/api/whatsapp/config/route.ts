import { NextRequest, NextResponse } from 'next/server';
import { whatsappEnv } from '@chatbot/whatsapp';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const appId = whatsappEnv.META_APP_ID ?? '';
  const configId = whatsappEnv.META_WHATSAPP_CONFIG_ID ?? '';

  return NextResponse.json({
    appId,
    // env validation is skipped entirely when META_APP_ID is unset (see libs/whatsapp/src/env.ts),
    // so defaults don't get applied either — fall back explicitly rather than send `undefined`.
    apiVersion: whatsappEnv.META_API_VERSION ?? 'v21.0',
    configId,
    // Both are required for Embedded Signup to actually open — the frontend uses this
    // to show a clear "not configured" message instead of a silent infinite spinner.
    configured: Boolean(appId && configId),
  });
}

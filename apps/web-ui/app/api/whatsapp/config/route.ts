import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json({
    appId: process.env.META_APP_ID ?? '',
    apiVersion: process.env.META_API_VERSION ?? 'v21.0',
  });
}

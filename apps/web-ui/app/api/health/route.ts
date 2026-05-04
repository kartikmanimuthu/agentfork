import { NextResponse } from 'next/server';
import { getPrismaClient } from '@chatbot/shared';
import { env } from '@/lib/env';

export async function GET() {
  const health: Record<string, unknown> = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'web-ui',
    environment: env.NODE_ENV,
  };

  try {
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    health.database = 'connected';
    return NextResponse.json(health, { status: 200 });
  } catch (error) {
    health.status = 'degraded';
    health.database = { status: 'error', error: error instanceof Error ? error.message : 'Unknown' };
    return NextResponse.json(health, { status: 207 });
  }
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, createLogger } from '@chatbot/shared';

const logger = createLogger('api:tenants:check-slug');

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ available: false }, { status: 400 });
  }

  try {
    const prisma = getPrismaClient();
    const existing = await prisma.tenant.findUnique({ where: { slug } });
    return NextResponse.json({ available: !existing });
  } catch (error) {
    logger.error({ error }, 'Check slug error');
    return NextResponse.json({ available: false }, { status: 500 });
  }
}

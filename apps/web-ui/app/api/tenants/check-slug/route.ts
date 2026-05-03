import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient, checkSlugQuerySchema, parseSearchParams, ValidationError } from '@chatbot/shared';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api-tenants-check-slug');

export async function GET(req: NextRequest) {
  try {
    const { slug } = parseSearchParams(req.nextUrl.searchParams, checkSlugQuerySchema);

    const prisma = getPrismaClient();
    const existing = await prisma.tenant.findUnique({ where: { slug } });
    return NextResponse.json({ available: !existing });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ available: false, error: error.message }, { status: 400 });
    }
    logger.error({ error }, 'Check slug error');
    return NextResponse.json({ available: false }, { status: 500 });
  }
}

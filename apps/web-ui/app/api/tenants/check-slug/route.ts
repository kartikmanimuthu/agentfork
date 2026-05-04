import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient } from '@chatbot/shared';

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
    console.error('Check slug error:', error);
    return NextResponse.json({ available: false }, { status: 500 });
  }
}

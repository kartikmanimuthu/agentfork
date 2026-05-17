import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Conversations', authOptions);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get('fromDate');
    const toDate = searchParams.get('toDate');
    const search = searchParams.get('search');
    const sentiment = searchParams.get('sentiment');
    const resolvedStatus = searchParams.get('resolvedStatus');
    const status = searchParams.get('status') || 'all';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    const prisma = getPrismaClient();

    const where: any = { tenantId };

    if (status !== 'all') where.status = status;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(`${toDate}T23:59:59.999Z`);
    }

    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
      ];
    }

    const analyticsFilter: any = {};
    if (sentiment && sentiment !== 'all') analyticsFilter.sentiment = sentiment;
    if (resolvedStatus === 'resolved') analyticsFilter.isResolved = true;
    else if (resolvedStatus === 'unresolved') analyticsFilter.isResolved = false;

    if (Object.keys(analyticsFilter).length > 0) {
      where.analytics = analyticsFilter;
    }

    const [sessions, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          analytics: {
            select: {
              sentiment: true,
              isResolved: true,
              confidenceScore: true,
              firstUserQuery: true,
              summary: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.conversation.count({ where }),
    ]);

    const result = sessions.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      messageCount: s.messageCount,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      feedbackRating: s.feedbackRating,
      firstUserQuery: s.analytics?.firstUserQuery || null,
      sentiment: s.analytics?.sentiment || null,
      isResolved: s.analytics?.isResolved ?? null,
      confidenceScore: s.analytics?.confidenceScore ?? null,
      summary: s.analytics?.summary || null,
    }));

    return NextResponse.json({
      sessions: result,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    console.error('Analytics sessions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

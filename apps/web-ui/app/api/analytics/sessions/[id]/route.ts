import { NextRequest, NextResponse } from 'next/server';
import { getSessionTenantId, authorize, getPrismaClient } from '@chatbot/shared';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getSessionTenantId(authOptions);
    const authError = await authorize('read', 'Conversations', authOptions);
    if (authError) return authError;

    const { id } = await params;
    const prisma = getPrismaClient();

    const conversation = await prisma.conversation.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        title: true,
        status: true,
        model: true,
        messageCount: true,
        feedbackRating: true,
        feedbackComment: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const [messages, analytics] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
      }),
      prisma.conversationAnalytics.findUnique({
        where: { conversationId: id },
        select: {
          sentiment: true,
          sentimentScores: true,
          isResolved: true,
          confidenceScore: true,
          emotionalTone: true,
          summary: true,
          firstUserQuery: true,
          language: true,
          analyzedAt: true,
        },
      }),
    ]);

    return NextResponse.json({
      session: conversation,
      messages,
      analytics,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    console.error('Analytics session detail error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

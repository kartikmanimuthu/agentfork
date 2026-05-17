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
    const sentiment = searchParams.get('sentiment');
    const resolvedStatus = searchParams.get('resolvedStatus');

    const prisma = getPrismaClient();

    const dateFilter: any = {};
    if (fromDate) dateFilter.gte = new Date(fromDate);
    if (toDate) dateFilter.lte = new Date(`${toDate}T23:59:59.999Z`);

    const analyticsWhere: any = { tenantId };
    if (Object.keys(dateFilter).length > 0) analyticsWhere.createdAt = dateFilter;
    if (sentiment && sentiment !== 'all') analyticsWhere.sentiment = sentiment;
    if (resolvedStatus === 'resolved') analyticsWhere.isResolved = true;
    else if (resolvedStatus === 'unresolved') analyticsWhere.isResolved = false;

    const conversationWhere: any = { tenantId };
    if (Object.keys(dateFilter).length > 0) conversationWhere.createdAt = dateFilter;

    const [
      totalConversations,
      activeConversations,
      completedConversations,
      analyticsRecords,
      feedbackRecords,
    ] = await Promise.all([
      prisma.conversation.count({ where: conversationWhere }),
      prisma.conversation.count({ where: { ...conversationWhere, status: 'active' } }),
      prisma.conversation.count({ where: { ...conversationWhere, status: 'completed' } }),
      prisma.conversationAnalytics.findMany({
        where: analyticsWhere,
        select: {
          sentiment: true,
          isResolved: true,
          confidenceScore: true,
          firstUserQuery: true,
          createdAt: true,
        },
      }),
      prisma.conversation.findMany({
        where: { ...conversationWhere, feedbackRating: { not: null } },
        select: { feedbackRating: true },
      }),
    ]);

    const sentimentDistribution = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
    let resolvedCount = 0;
    let unresolvedCount = 0;
    let totalConfidence = 0;
    let confidenceCount = 0;

    const sentimentByDate: Record<string, { positive: number; negative: number; neutral: number; mixed: number }> = {};
    const resolutionByDate: Record<string, { resolved: number; unresolved: number }> = {};
    const volumeByDate: Record<string, number> = {};

    const queryCountAll: Record<string, number> = {};
    const queryCountPositive: Record<string, number> = {};
    const queryCountNegative: Record<string, number> = {};

    for (const record of analyticsRecords) {
      const s = record.sentiment?.toLowerCase();
      if (s && s in sentimentDistribution) {
        sentimentDistribution[s as keyof typeof sentimentDistribution]++;
      }

      if (record.isResolved === true) resolvedCount++;
      else if (record.isResolved === false) unresolvedCount++;

      if (record.confidenceScore != null) {
        totalConfidence += record.confidenceScore;
        confidenceCount++;
      }

      const dateKey = record.createdAt.toISOString().split('T')[0];
      if (!sentimentByDate[dateKey]) sentimentByDate[dateKey] = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
      if (s && s in sentimentByDate[dateKey]) {
        sentimentByDate[dateKey][s as keyof typeof sentimentDistribution]++;
      }

      if (!resolutionByDate[dateKey]) resolutionByDate[dateKey] = { resolved: 0, unresolved: 0 };
      if (record.isResolved === true) resolutionByDate[dateKey].resolved++;
      else if (record.isResolved === false) resolutionByDate[dateKey].unresolved++;

      volumeByDate[dateKey] = (volumeByDate[dateKey] || 0) + 1;

      const query = record.firstUserQuery;
      if (query && query.length > 3) {
        queryCountAll[query] = (queryCountAll[query] || 0) + 1;
        if (record.sentiment === 'POSITIVE') queryCountPositive[query] = (queryCountPositive[query] || 0) + 1;
        else if (record.sentiment === 'NEGATIVE') queryCountNegative[query] = (queryCountNegative[query] || 0) + 1;
      }
    }

    const topN = (map: Record<string, number>, n = 10) =>
      Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([query, count]) => ({ query, count }));

    let promoters = 0, passives = 0, detractors = 0;
    const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    for (const { feedbackRating } of feedbackRecords) {
      if (feedbackRating == null) continue;
      ratingDistribution[feedbackRating] = (ratingDistribution[feedbackRating] || 0) + 1;
      if (feedbackRating >= 4) promoters++;
      else if (feedbackRating === 3) passives++;
      else detractors++;
    }

    const totalWithRatings = promoters + passives + detractors;
    const npsScore = totalWithRatings > 0
      ? Math.round(((promoters - detractors) / totalWithRatings) * 100)
      : 0;

    const totalAnalyzed = resolvedCount + unresolvedCount;
    const resolutionRate = totalAnalyzed > 0 ? Math.round((resolvedCount / totalAnalyzed) * 100) : 0;

    return NextResponse.json({
      counts: {
        total: totalConversations,
        active: activeConversations,
        completed: completedConversations,
        resolved: resolvedCount,
        unresolved: unresolvedCount,
        analyzed: analyticsRecords.length,
      },
      sentimentDistribution,
      resolutionRate,
      avgConfidence: confidenceCount > 0 ? Math.round((totalConfidence / confidenceCount) * 100) / 100 : 0,
      trends: {
        sentiment: Object.entries(sentimentByDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
        resolution: Object.entries(resolutionByDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
        volume: Object.entries(volumeByDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
      },
      topQueries: {
        mostAsked: topN(queryCountAll),
        positive: topN(queryCountPositive),
        negative: topN(queryCountNegative),
      },
      nps: {
        score: npsScore,
        promoters,
        passives,
        detractors,
        totalWithRatings,
        ratingDistribution,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthenticated')) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    console.error('Analytics summary error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

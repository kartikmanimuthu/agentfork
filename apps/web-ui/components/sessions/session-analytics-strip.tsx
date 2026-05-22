'use client';

import { Badge } from '@/components/ui/badge';

const SENTIMENT_COLORS: Record<string, string> = {
  POSITIVE: '#10B981',
  NEGATIVE: '#EF4444',
  NEUTRAL: '#6366F1',
  MIXED: '#F59E0B',
};

interface SessionAnalyticsStripProps {
  analytics: {
    sentiment: string | null;
    isResolved: boolean | null;
    confidenceScore: number | null;
    language: string | null;
    summary: string | null;
  };
}

export function SessionAnalyticsStrip({ analytics }: SessionAnalyticsStripProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/40 px-4 py-2.5 text-sm">
      {analytics.sentiment && (
        <div className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: SENTIMENT_COLORS[analytics.sentiment] }}
          />
          <span className="text-xs font-medium">{analytics.sentiment.toLowerCase()}</span>
        </div>
      )}
      {analytics.isResolved !== null && (
        <Badge
          variant="outline"
          className="text-[11px] px-2 py-0"
          style={{
            borderColor: analytics.isResolved ? '#10B981' : '#EF4444',
            color: analytics.isResolved ? '#10B981' : '#EF4444',
          }}
        >
          {analytics.isResolved ? 'Resolved' : 'Unresolved'}
        </Badge>
      )}
      {analytics.confidenceScore !== null && (
        <span className="text-xs text-muted-foreground">
          {(analytics.confidenceScore * 100).toFixed(0)}% confidence
        </span>
      )}
      {analytics.language && (
        <Badge variant="outline" className="text-[11px] px-2 py-0">
          {analytics.language}
        </Badge>
      )}
      {analytics.summary && (
        <span className="text-xs text-muted-foreground truncate flex-1 ml-2 border-l pl-3">
          {analytics.summary}
        </span>
      )}
    </div>
  );
}

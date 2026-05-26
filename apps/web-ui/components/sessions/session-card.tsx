'use client';

import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bot, MessageSquare, Clock, Zap } from 'lucide-react';

const SENTIMENT_COLORS: Record<string, string> = {
  POSITIVE: '#10B981',
  NEGATIVE: '#EF4444',
  NEUTRAL: '#6366F1',
  MIXED: '#F59E0B',
};

interface SessionCardProps {
  session: {
    id: string;
    name: string | null;
    channel: string;
    status: string;
    startedAt: string;
    lastActivityAt: string;
    endedAt: string | null;
    endReason: string | null;
    messageCount: number;
    avgLatencyMs: number | null;
    agent: { id: string; name: string; type: string } | null;
    agentVersion: { id: string; version: number; status: string } | null;
    analytics: {
      sentiment: string | null;
      isResolved: boolean | null;
      firstUserQuery: string | null;
      summary: string | null;
    } | null;
  };
  onClick: () => void;
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};

export function SessionCard({ session, onClick }: SessionCardProps) {
  const title = session.analytics?.firstUserQuery || session.name || 'Untitled session';
  const summary = session.analytics?.summary;

  const formatLatency = (ms: number | null) => {
    if (ms === null) return '—';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const duration = () => {
    const start = new Date(session.startedAt).getTime();
    const end = session.endedAt
      ? new Date(session.endedAt).getTime()
      : new Date(session.lastActivityAt).getTime();
    const mins = Math.floor((end - start) / 60000);
    if (mins < 1) return '<1m';
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  const timeAgo = () => {
    const diff = Date.now() - new Date(session.lastActivityAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <motion.div variants={itemVariants}>
      <Card
        className="group cursor-pointer border transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-foreground/15 h-full"
        onClick={onClick}
      >
        <CardContent className="p-4 flex flex-col h-full">
          {/* Top: Agent + Status */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Bot className="h-3 w-3" />
              <span className="truncate max-w-[140px]">
                {session.agent?.name ?? 'Unknown'}
                {session.agentVersion ? ` v${session.agentVersion.version}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {session.analytics?.sentiment && (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: SENTIMENT_COLORS[session.analytics.sentiment] }}
                />
              )}
              <span
                className={`h-2 w-2 rounded-full ${session.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/40'}`}
              />
            </div>
          </div>

          {/* Middle: Title + Summary */}
          <div className="flex-1 mb-3">
            <p className="text-sm font-medium leading-snug line-clamp-2 mb-1">{title}</p>
            {summary && (
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{summary}</p>
            )}
          </div>

          {/* Bottom: Metadata chips */}
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-2 border-t">
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {session.messageCount}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {duration()}
            </span>
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3" />
              {formatLatency(session.avgLatencyMs)}
            </span>
            <span className="ml-auto">{timeAgo()}</span>
          </div>

          {/* Badges row */}
          <div className="flex items-center gap-1.5 mt-2">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{session.channel}</Badge>
            {session.analytics?.isResolved !== null && session.analytics?.isResolved !== undefined && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0"
                style={{
                  borderColor: session.analytics.isResolved ? '#10B981' : '#EF4444',
                  color: session.analytics.isResolved ? '#10B981' : '#EF4444',
                }}
              >
                {session.analytics.isResolved ? 'Resolved' : 'Unresolved'}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

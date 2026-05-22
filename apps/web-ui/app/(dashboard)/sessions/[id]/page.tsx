'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ChevronLeft, Bot, Clock, MessageSquare, Zap, Globe } from 'lucide-react';
import { SessionChatMessage } from '@/components/sessions/session-chat-message';

const SENTIMENT_COLORS: Record<string, string> = {
  POSITIVE: '#10B981',
  NEGATIVE: '#EF4444',
  NEUTRAL: '#6366F1',
  MIXED: '#F59E0B',
};

interface SessionDetail {
  session: {
    id: string;
    name: string | null;
    channel: string;
    channelMetadata: unknown;
    status: string;
    startedAt: string;
    lastActivityAt: string;
    idleExpiresAt: string;
    endedAt: string | null;
    endReason: string | null;
    agent: { id: string; name: string; type: string } | null;
    agentVersion: { id: string; version: number; status: string } | null;
  };
  messages: Array<{
    id: string;
    role: string;
    content: string;
    tokenCount: number | null;
    createdAt: string;
  }>;
  analytics: {
    sentiment: string | null;
    sentimentScores: unknown;
    isResolved: boolean | null;
    confidenceScore: number | null;
    emotionalTone: unknown;
    summary: string | null;
    firstUserQuery: string | null;
    language: string | null;
    messageCount: number | null;
    analyzedAt: string;
  } | null;
  executions: Array<{
    id: string;
    status: string;
    latencyMs: number | null;
    tokenUsage: unknown;
    cacheHit: boolean;
    webhookStatus: string | null;
    webhookDeliveredAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
    createdAt: string;
  }>;
}

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const { data, isLoading, error } = useQuery({
    queryKey: ['session-detail', id],
    queryFn: async (): Promise<SessionDetail> => {
      const res = await fetch(`/api/sessions/${id}`);
      if (!res.ok) throw new Error('Failed to load session');
      return res.json();
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)]">
        <div className="flex-1 p-6 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-[60vh] w-full" />
        </div>
        <div className="w-80 border-l p-4 space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => router.push('/sessions')}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Card className="mt-4">
          <CardContent className="py-12 text-center text-muted-foreground">
            Session not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { session: s, messages, analytics, executions } = data;

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  const formatLatency = (ms: number | null) => {
    if (ms === null) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  const tokenTotal = (u: unknown): string => {
    if (!u || typeof u !== 'object') return '—';
    const t = (u as { totalTokens?: number }).totalTokens;
    return typeof t === 'number' ? t.toLocaleString() : '—';
  };

  const duration = () => {
    const start = new Date(s.startedAt).getTime();
    const end = s.endedAt ? new Date(s.endedAt).getTime() : new Date(s.lastActivityAt).getTime();
    const mins = Math.floor((end - start) / 60000);
    if (mins < 1) return '<1 min';
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  const title = analytics?.firstUserQuery || s.name || 'Untitled session';

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left: Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => router.push('/sessions')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold tracking-tight truncate">{title}</h1>
              <p className="text-xs text-muted-foreground font-mono">{s.id}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className="text-xs">{s.channel}</Badge>
              <Badge variant={s.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                {s.status}{s.endReason ? ` · ${s.endReason}` : ''}
              </Badge>
            </div>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1" type="always">
          <div className="p-6 space-y-5">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No messages recorded.</p>
            ) : (
              messages.map((m) => (
                <SessionChatMessage
                  key={m.id}
                  role={m.role}
                  content={m.content}
                  timestamp={m.createdAt}
                  tokenCount={m.tokenCount}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right: Sidebar */}
      <div className="w-80 xl:w-96 border-l shrink-0 overflow-y-auto bg-muted/20">
        <div className="p-4 space-y-4">
          {/* Session Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Session Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Agent:</span>
                <span className="font-medium">
                  {s.agent?.name ?? '—'}
                  {s.agentVersion ? ` v${s.agentVersion.version}` : ''}
                </span>
              </div>
              {s.agent?.type && (
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Type:</span>
                  <Badge variant="outline" className="text-[10px]">{s.agent.type}</Badge>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Started:</span>
                <span>{formatDate(s.startedAt)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Duration:</span>
                <span>{duration()}</span>
              </div>
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Messages:</span>
                <span>{messages.length}</span>
              </div>
              {s.endedAt && (
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Ended:</span>
                  <span>{formatDate(s.endedAt)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Channel Metadata */}
          {Boolean(s.channelMetadata) && typeof s.channelMetadata === 'object' && Object.keys(s.channelMetadata as Record<string, unknown>).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5" />
                  Channel Metadata
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="bg-muted/40 rounded p-2.5 text-xs overflow-auto max-h-32 font-mono">
                  {JSON.stringify(s.channelMetadata, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}

          {/* Analytics */}
          {analytics && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Analytics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {analytics.sentiment && (
                    <Badge
                      variant="outline"
                      className="text-[11px]"
                      style={{
                        borderColor: SENTIMENT_COLORS[analytics.sentiment],
                        color: SENTIMENT_COLORS[analytics.sentiment],
                      }}
                    >
                      {analytics.sentiment}
                    </Badge>
                  )}
                  {analytics.isResolved !== null && (
                    <Badge
                      variant="outline"
                      className="text-[11px]"
                      style={{
                        borderColor: analytics.isResolved ? '#10B981' : '#EF4444',
                        color: analytics.isResolved ? '#10B981' : '#EF4444',
                      }}
                    >
                      {analytics.isResolved ? 'Resolved' : 'Unresolved'}
                    </Badge>
                  )}
                  {analytics.language && (
                    <Badge variant="outline" className="text-[11px]">{analytics.language}</Badge>
                  )}
                  {analytics.confidenceScore !== null && (
                    <Badge variant="outline" className="text-[11px]">
                      {(analytics.confidenceScore * 100).toFixed(0)}% conf
                    </Badge>
                  )}
                </div>
                {analytics.summary && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{analytics.summary}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Executions */}
          {executions.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Executions ({executions.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {executions.map((ex) => (
                  <div key={ex.id} className="rounded border p-2.5 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-muted-foreground">{ex.id.slice(0, 12)}…</span>
                      <Badge
                        variant={ex.status === 'completed' ? 'default' : 'destructive'}
                        className="text-[10px] px-1.5"
                      >
                        {ex.status}
                      </Badge>
                    </div>
                    <Separator />
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      <div>
                        <span className="text-muted-foreground">Latency: </span>
                        <span className="font-mono">{formatLatency(ex.latencyMs)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Tokens: </span>
                        <span className="font-mono">{tokenTotal(ex.tokenUsage)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Cache: </span>
                        <span>{ex.cacheHit ? 'hit' : 'miss'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Webhook: </span>
                        <span>{ex.webhookStatus ?? '—'}</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {formatDate(ex.completedAt ?? ex.createdAt)}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

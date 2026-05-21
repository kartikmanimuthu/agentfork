'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { ChevronLeft } from 'lucide-react';

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
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
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
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  const tokenTotal = (u: unknown): number | null => {
    if (!u || typeof u !== 'object') return null;
    const t = (u as { totalTokens?: number }).totalTokens;
    return typeof t === 'number' ? t : null;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push('/sessions')}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight font-mono">{s.id}</h1>
        <Badge variant="outline">{s.channel}</Badge>
        <Badge variant={s.status === 'active' ? 'default' : 'secondary'}>
          {s.status}
          {s.endReason ? ` · ${s.endReason}` : ''}
        </Badge>
      </div>

      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground text-xs">Agent</div>
            <div>{s.agent?.name ?? '—'}{s.agent ? ` · ${s.agent.type}` : ''}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Version</div>
            <div>{s.agentVersion ? `v${s.agentVersion.version} (${s.agentVersion.status})` : '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Name</div>
            <div>{s.name ?? '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Started</div>
            <div>{formatDate(s.startedAt)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Last activity</div>
            <div>{formatDate(s.lastActivityAt)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">
              {s.status === 'ended' ? 'Ended' : 'Idle expires'}
            </div>
            <div>{s.status === 'ended' ? formatDate(s.endedAt) : formatDate(s.idleExpiresAt)}</div>
          </div>
        </CardContent>
      </Card>

      {/* Channel metadata */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Channel metadata</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted/40 rounded p-3 text-xs overflow-auto max-h-48">
            {JSON.stringify(s.channelMetadata ?? null, null, 2)}
          </pre>
        </CardContent>
      </Card>

      {/* Analytics */}
      {analytics && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Analytics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              {analytics.sentiment && (
                <Badge
                  variant="outline"
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
                  style={{
                    borderColor: analytics.isResolved ? '#10B981' : '#EF4444',
                    color: analytics.isResolved ? '#10B981' : '#EF4444',
                  }}
                >
                  {analytics.isResolved ? 'Resolved' : 'Unresolved'}
                </Badge>
              )}
              {analytics.language && <Badge variant="outline">{analytics.language}</Badge>}
              {analytics.confidenceScore !== null && (
                <span className="text-xs text-muted-foreground">
                  confidence {(analytics.confidenceScore * 100).toFixed(0)}%
                </span>
              )}
            </div>
            {analytics.summary && (
              <div>
                <div className="text-muted-foreground text-xs mb-1">Summary</div>
                <p>{analytics.summary}</p>
              </div>
            )}
            {analytics.firstUserQuery && (
              <div>
                <div className="text-muted-foreground text-xs mb-1">First user query</div>
                <p>{analytics.firstUserQuery}</p>
              </div>
            )}
            <Separator />
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <div className="text-muted-foreground mb-1">Sentiment scores</div>
                <pre className="bg-muted/40 rounded p-2 overflow-auto">
                  {JSON.stringify(analytics.sentimentScores ?? null, null, 2)}
                </pre>
              </div>
              <div>
                <div className="text-muted-foreground mb-1">Emotional tone</div>
                <pre className="bg-muted/40 rounded p-2 overflow-auto">
                  {JSON.stringify(analytics.emotionalTone ?? null, null, 2)}
                </pre>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Messages timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Messages ({messages.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages recorded yet.</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="border rounded p-3 space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={m.role === 'user' ? 'default' : 'secondary'} className="text-[10px]">
                    {m.role}
                  </Badge>
                  <span>{formatDate(m.createdAt)}</span>
                  {m.tokenCount !== null && <span>{m.tokenCount} tok</span>}
                </div>
                <div className="text-sm whitespace-pre-wrap">{m.content}</div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Executions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Executions ({executions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {executions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No executions linked to this session.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-3">ID</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Latency</th>
                    <th className="py-2 pr-3">Tokens</th>
                    <th className="py-2 pr-3">Cache</th>
                    <th className="py-2 pr-3">Webhook</th>
                    <th className="py-2 pr-3">When</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((ex) => (
                    <tr key={ex.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 font-mono text-xs">{ex.id.slice(0, 10)}…</td>
                      <td className="py-2 pr-3">
                        <Badge variant={ex.status === 'completed' ? 'default' : 'secondary'} className="text-[10px]">
                          {ex.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3">{formatLatency(ex.latencyMs)}</td>
                      <td className="py-2 pr-3">{tokenTotal(ex.tokenUsage) ?? '—'}</td>
                      <td className="py-2 pr-3">{ex.cacheHit ? 'hit' : 'miss'}</td>
                      <td className="py-2 pr-3">{ex.webhookStatus ?? '—'}</td>
                      <td className="py-2 pr-3 text-xs">{formatDate(ex.completedAt ?? ex.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

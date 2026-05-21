'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, Copy, ExternalLink } from 'lucide-react';

interface InferenceDetail {
  execution: {
    id: string;
    agentId: string;
    agentVersionId: string | null;
    sessionId: string | null;
    status: string;
    input: {
      messages?: Array<{ role: string; content?: string }>;
      systemPrompt?: string;
    } | null;
    output: { text?: string } | null;
    error: string | null;
    tokenUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
    cacheHit: boolean;
    latencyMs: number | null;
    webhookUrl: string | null;
    webhookStatus: string | null;
    webhookDeliveredAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
  };
  agent: { id: string; name: string; type: string } | null;
  agentVersion: { id: string; version: number; status: string } | null;
  session: { id: string; status: string; channel: string; channelMetadata: unknown } | null;
}

export default function InferenceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const { data, isLoading, error } = useQuery({
    queryKey: ['inference-detail', id],
    queryFn: async (): Promise<InferenceDetail> => {
      const res = await fetch(`/api/inferences/${id}`);
      if (!res.ok) throw new Error('Failed to load inference');
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
        <Button variant="ghost" size="sm" onClick={() => router.push('/inferences')}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Card className="mt-4">
          <CardContent className="py-12 text-center text-muted-foreground">
            Inference execution not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { execution: ex, agent, agentVersion, session } = data;

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  const formatLatency = (ms: number | null) => {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  const isStateful = !!ex.sessionId;
  const statusVariant: 'default' | 'secondary' | 'destructive' =
    ex.status === 'completed' ? 'default' : ex.status === 'failed' ? 'destructive' : 'secondary';
  const inputMessages = ex.input?.messages ?? [];
  const systemPrompt = ex.input?.systemPrompt;
  const outputText = ex.output?.text ?? null;

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => router.push('/inferences')}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-lg font-semibold tracking-tight font-mono">{ex.id}</h1>
        <Badge variant={statusVariant}>{ex.status}</Badge>
        <Badge variant={isStateful ? 'default' : 'secondary'}>
          {isStateful ? 'Stateful' : 'Stateless'}
        </Badge>
      </div>

      {/* Execution summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Execution</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground text-xs">Agent</div>
            <div>{agent?.name ?? '—'}{agent ? ` · ${agent.type}` : ''}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Version</div>
            <div>{agentVersion ? `v${agentVersion.version} (${agentVersion.status})` : '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Cache</div>
            <div>{ex.cacheHit ? 'Hit' : 'Miss'}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Started</div>
            <div>{formatDate(ex.startedAt ?? ex.createdAt)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Completed</div>
            <div>{formatDate(ex.completedAt)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Latency</div>
            <div>{formatLatency(ex.latencyMs)}</div>
          </div>
          {ex.tokenUsage && (
            <>
              <div>
                <div className="text-muted-foreground text-xs">Input tokens</div>
                <div>{ex.tokenUsage.inputTokens ?? '—'}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Output tokens</div>
                <div>{ex.tokenUsage.outputTokens ?? '—'}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Total tokens</div>
                <div>{ex.tokenUsage.totalTokens ?? '—'}</div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Session card — stateful only */}
      {isStateful && session && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs">{session.id}</span>
              <Badge
                variant={session.status === 'active' ? 'default' : 'secondary'}
                className="text-[10px]"
              >
                {session.status}
              </Badge>
              <Badge variant="outline" className="text-[10px]">{session.channel}</Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => router.push(`/sessions/${session.id}`)}
              >
                View session <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </div>
            {session.channelMetadata != null && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Channel metadata
                </summary>
                <pre className="mt-2 bg-muted/40 rounded p-2 overflow-auto max-h-32">
                  {JSON.stringify(session.channelMetadata, null, 2)}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* Input / Output */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Input / Output</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            {/* Input */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Input</div>
              {systemPrompt && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    System prompt
                  </summary>
                  <pre className="mt-1 bg-muted/40 rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap">
                    {systemPrompt}
                  </pre>
                </details>
              )}
              <div className="space-y-2">
                {inputMessages.map((m, i) => (
                  <div
                    key={i}
                    className={`rounded p-2 text-sm ${
                      m.role === 'user' ? 'bg-primary/10 ml-8' : 'bg-muted/40 mr-8'
                    }`}
                  >
                    <div className="text-[10px] text-muted-foreground mb-1 capitalize">{m.role}</div>
                    <div className="whitespace-pre-wrap">{m.content ?? ''}</div>
                  </div>
                ))}
                {inputMessages.length === 0 && (
                  <p className="text-xs text-muted-foreground">No messages in input.</p>
                )}
              </div>
            </div>

            {/* Output */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">Output</div>
                {outputText && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => copyToClipboard(outputText)}
                  >
                    <Copy className="h-3 w-3 mr-1" /> Copy
                  </Button>
                )}
              </div>
              {outputText ? (
                <div className="bg-muted/40 rounded p-3 text-sm whitespace-pre-wrap max-h-96 overflow-auto">
                  {outputText}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No output recorded.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Webhook card */}
      {ex.webhookUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Webhook</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs truncate max-w-xs">{ex.webhookUrl}</span>
              {ex.webhookStatus && (
                <Badge
                  variant={ex.webhookStatus === 'delivered' ? 'default' : 'destructive'}
                  className="text-[10px]"
                >
                  {ex.webhookStatus}
                </Badge>
              )}
              {ex.webhookDeliveredAt && (
                <span className="text-xs text-muted-foreground">{formatDate(ex.webhookDeliveredAt)}</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error card */}
      {ex.status === 'failed' && ex.error && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-destructive/10 border border-destructive/20 rounded p-3 text-xs text-destructive overflow-auto whitespace-pre-wrap">
              {ex.error}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

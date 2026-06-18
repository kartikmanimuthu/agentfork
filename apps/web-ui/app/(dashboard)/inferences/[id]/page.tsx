'use client';

import { useState, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import {
  ChevronLeft,
  Copy,
  Check,
  Clock,
  Zap,
  Hash,
  Coins,
  LayoutDashboard,
  GitBranch,
  FileCode,
  BarChart3,
  ExternalLink,
} from 'lucide-react';
import { InferenceOverview } from '@/components/inferences/inference-overview';
import { InferenceTrace } from '@/components/inferences/inference-trace';
import { InferenceRaw } from '@/components/inferences/inference-raw';
import { InferenceMetrics } from '@/components/inferences/inference-metrics';
import { ScoreDrawer } from '@/components/evaluation/score-drawer';

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

type ConsoleTab = 'overview' | 'trace' | 'raw' | 'metrics';

const TABS: { id: ConsoleTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'trace', label: 'Trace', icon: GitBranch },
  { id: 'raw', label: 'Raw', icon: FileCode },
  { id: 'metrics', label: 'Metrics', icon: BarChart3 },
];

export default function InferenceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [activeTab, setActiveTab] = useState<ConsoleTab>('overview');
  const [copiedOutput, setCopiedOutput] = useState(false);

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
      <div className="flex h-[calc(100vh-4rem)]">
        <div className="flex-1 p-6 space-y-4">
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-[60vh] w-full" />
        </div>
        <div className="w-[40%] border-l p-4 space-y-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
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

  const formatLatency = (ms: number | null) => {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const isStateful = !!ex.sessionId;
  const statusVariant: 'default' | 'secondary' | 'destructive' =
    ex.status === 'completed' ? 'default' : ex.status === 'failed' ? 'destructive' : 'secondary';
  const inputMessages = ex.input?.messages ?? [];
  const systemPrompt = ex.input?.systemPrompt;
  const outputText = ex.output?.text ?? null;
  const totalTokens = ex.tokenUsage?.totalTokens ?? 0;

  const handleCopyOutput = async () => {
    if (!outputText) return;
    await navigator.clipboard.writeText(outputText);
    setCopiedOutput(true);
    setTimeout(() => setCopiedOutput(false), 2000);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="border-b px-6 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => router.push('/inferences')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm font-semibold tracking-tight font-mono truncate">
                {ex.id}
              </h1>
              <Badge variant={statusVariant} className="text-[10px]">
                {ex.status}
              </Badge>
              <Badge variant={isStateful ? 'default' : 'secondary'} className="text-[10px]">
                {isStateful ? 'Stateful' : 'Stateless'}
              </Badge>
              {isStateful && session && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-2 text-[10px] text-muted-foreground hover:text-foreground gap-1"
                  onClick={() => router.push(`/sessions/${session.id}`)}
                >
                  <ExternalLink className="h-3 w-3" />
                  View Session
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
              {agent && <span>{agent.name} · {agent.type}</span>}
              {agentVersion && <span>v{agentVersion.version}</span>}
            </div>
          </div>

          {/* Quick stats */}
          <div className="flex items-center gap-4 shrink-0">
            <div className="flex items-center gap-1.5 text-[11px]">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono font-medium">{formatLatency(ex.latencyMs)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <Hash className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono font-medium">{totalTokens.toLocaleString()} tok</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <Coins className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono font-medium">
                ${(((ex.tokenUsage?.inputTokens ?? 0) / 1_000_000) * 3 + ((ex.tokenUsage?.outputTokens ?? 0) / 1_000_000) * 15).toFixed(4)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <Zap className="h-3 w-3 text-muted-foreground" />
              <Badge variant={ex.cacheHit ? 'default' : 'secondary'} className="text-[9px] h-4">
                {ex.cacheHit ? 'Cache Hit' : 'Cache Miss'}
              </Badge>
            </div>
          </div>
          {isStateful && session ? (
            <ScoreDrawer targetType="SESSION" targetId={session.id} />
          ) : (
            <ScoreDrawer targetType="EXECUTION" targetId={ex.id} />
          )}
        </div>
      </div>

      {/* Main content: resizable two panels */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
        {/* Left panel: Input / Output */}
        <ResizablePanel defaultSize={60} minSize={30}>
          <ScrollArea className="h-full" type="always">
            <div className="p-6 space-y-6">
              {/* Input section */}
              <div className="space-y-3">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Input
                </div>

                {systemPrompt && (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="text-[10px] text-muted-foreground font-medium mb-1">System Prompt</div>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{systemPrompt}</p>
                  </div>
                )}

                {inputMessages.length > 0 && (
                  <div className="space-y-2">
                    {inputMessages.map((m, i) => (
                      <div key={i} className="rounded-md border bg-muted/30 p-3">
                        <div className="text-[10px] text-muted-foreground font-medium mb-1 capitalize">
                          {m.role}
                        </div>
                        <div className="text-sm whitespace-pre-wrap leading-relaxed">
                          {m.content ?? ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {inputMessages.length === 0 && !systemPrompt && (
                  <p className="text-xs text-muted-foreground">No input recorded.</p>
                )}
              </div>

              {/* Output section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Output
                  </div>
                  {outputText && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] gap-1"
                      onClick={handleCopyOutput}
                    >
                      {copiedOutput ? (
                        <><Check className="h-3 w-3 text-green-500" /> Copied</>
                      ) : (
                        <><Copy className="h-3 w-3" /> Copy</>
                      )}
                    </Button>
                  )}
                </div>

                {outputText ? (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{outputText}</div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No output recorded.</p>
                )}
              </div>

              {/* Error */}
              {ex.status === 'failed' && ex.error && (
                <div className="space-y-3">
                  <div className="text-xs font-medium text-destructive uppercase tracking-wider">
                    Error
                  </div>
                  <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3">
                    <pre className="text-xs text-destructive font-mono whitespace-pre-wrap overflow-auto max-h-48">
                      {ex.error}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right panel: Tabbed console */}
        <ResizablePanel defaultSize={40} minSize={25}>
          <div className="flex flex-col h-full bg-background">
            {/* Tab bar */}
            <div className="flex items-center border-b bg-background/80 backdrop-blur-sm px-1 shrink-0">
              {TABS.map(({ id: tabId, label, icon: Icon }) => (
                <button
                  key={tabId}
                  onClick={() => setActiveTab(tabId)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium transition-colors border-b-2 -mb-px',
                    activeTab === tabId
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden">
              {activeTab === 'overview' && (
                <InferenceOverview
                  execution={ex}
                  agent={agent}
                  agentVersion={agentVersion}
                  session={session}
                />
              )}
              {activeTab === 'trace' && (
                <InferenceTrace execution={ex} agent={agent} />
              )}
              {activeTab === 'raw' && (
                <InferenceRaw execution={ex} agent={agent} agentVersion={agentVersion} />
              )}
              {activeTab === 'metrics' && (
                <InferenceMetrics execution={ex} agent={agent} />
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

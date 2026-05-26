'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Bot,
  Clock,
  Zap,
  Globe,
  ExternalLink,
  Webhook,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

interface OverviewProps {
  execution: {
    id: string;
    agentId: string;
    agentVersionId: string | null;
    sessionId: string | null;
    status: string;
    cacheHit: boolean;
    latencyMs: number | null;
    webhookUrl: string | null;
    webhookStatus: string | null;
    webhookDeliveredAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    tokenUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
  };
  agent: { id: string; name: string; type: string } | null;
  agentVersion: { id: string; version: number; status: string } | null;
  session: { id: string; status: string; channel: string; channelMetadata: unknown } | null;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <div className="text-[11px] font-medium text-right">{children}</div>
    </div>
  );
}

export function InferenceOverview({ execution: ex, agent, agentVersion, session }: OverviewProps) {
  const router = useRouter();

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Execution Details */}
        <div>
          <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
            Execution Details
          </span>
          <div className="mt-2 space-y-0.5">
            <InfoRow icon={Bot} label="Agent">
              <span>{agent?.name ?? '—'}</span>
              {agent?.type && (
                <Badge variant="outline" className="text-[9px] ml-1.5">
                  {agent.type}
                </Badge>
              )}
            </InfoRow>
            <InfoRow icon={Zap} label="Version">
              {agentVersion ? (
                <span>
                  v{agentVersion.version}
                  <Badge
                    variant={agentVersion.status === 'published' ? 'default' : 'secondary'}
                    className="text-[9px] ml-1.5"
                  >
                    {agentVersion.status}
                  </Badge>
                </span>
              ) : (
                '—'
              )}
            </InfoRow>
            <InfoRow icon={Zap} label="Cache">
              <Badge
                variant={ex.cacheHit ? 'default' : 'secondary'}
                className="text-[9px]"
              >
                {ex.cacheHit ? 'Hit' : 'Miss'}
              </Badge>
            </InfoRow>
          </div>
        </div>

        <Separator />

        {/* Timing */}
        <div>
          <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
            Timing
          </span>
          <div className="mt-2 space-y-0.5">
            <InfoRow icon={Clock} label="Started">
              {formatDate(ex.startedAt ?? ex.createdAt)}
            </InfoRow>
            <InfoRow icon={Clock} label="Completed">
              {formatDate(ex.completedAt)}
            </InfoRow>
            <InfoRow icon={Clock} label="Created">
              {formatDate(ex.createdAt)}
            </InfoRow>
          </div>
        </div>

        <Separator />

        {/* Session */}
        {session && (
          <>
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
                Session
              </span>
              <div className="mt-2 rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[140px]">
                    {session.id}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant={session.status === 'active' ? 'default' : 'secondary'}
                      className="text-[9px]"
                    >
                      {session.status}
                    </Badge>
                    <Badge variant="outline" className="text-[9px]">
                      {session.channel}
                    </Badge>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px] w-full justify-start"
                  onClick={() => router.push(`/sessions/${session.id}`)}
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  View session
                </Button>
                {session.channelMetadata != null &&
                  typeof session.channelMetadata === 'object' &&
                  Object.keys(session.channelMetadata as Record<string, unknown>).length > 0 && (
                    <div className="mt-2">
                      <span className="text-[9px] uppercase text-muted-foreground font-semibold">
                        Channel Metadata
                      </span>
                      <pre className="mt-1 bg-muted/40 rounded p-2 text-[10px] font-mono overflow-auto max-h-24">
                        {JSON.stringify(session.channelMetadata, null, 2)}
                      </pre>
                    </div>
                  )}
              </div>
            </div>
            <Separator />
          </>
        )}

        {/* Webhook */}
        {ex.webhookUrl && (
          <div>
            <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
              Webhook
            </span>
            <div className="mt-2 rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Webhook className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="font-mono text-[10px] truncate">{ex.webhookUrl}</span>
              </div>
              <div className="flex items-center gap-2">
                {ex.webhookStatus === 'delivered' ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                ) : ex.webhookStatus === 'failed' ? (
                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />
                )}
                <Badge
                  variant={ex.webhookStatus === 'delivered' ? 'default' : 'destructive'}
                  className="text-[9px]"
                >
                  {ex.webhookStatus ?? 'pending'}
                </Badge>
                {ex.webhookDeliveredAt && (
                  <span className="text-[10px] text-muted-foreground">
                    {formatDate(ex.webhookDeliveredAt)}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Radio, CheckCircle2, Loader2, PauseCircle, Plug, Settings2, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeaderTitle } from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useConnectors, useResetConnector, type ConnectorSummary } from '@/hooks/use-connectors';
import { CHANNEL_VISUALS } from './channel-visuals';

function StatusBadge({ connector }: { connector: ConnectorSummary }) {
  if (!connector.configured) {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground">
        Not configured
      </Badge>
    );
  }
  if (!connector.enabled) {
    return (
      <Badge variant="outline" className="gap-1 text-xs text-amber-600 dark:text-amber-500 border-amber-500/40">
        <PauseCircle className="h-3 w-3" /> Deactivated
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 text-xs text-green-600 dark:text-green-500">
      <CheckCircle2 className="h-3 w-3" /> Active
    </Badge>
  );
}

/**
 * The declared HIL capabilities drive the gateway's fallback behavior once
 * inbound routing lands, so surfacing them here keeps them honest and visible
 * rather than invisible config.
 */
function CapabilityBadges({ connector }: { connector: ConnectorSummary }) {
  const caps = [
    connector.hilCapabilities.clarification && 'Follow-up questions',
    connector.hilCapabilities.approvalButtons && 'Approval buttons',
    connector.hilCapabilities.threadedReplies && 'Threaded replies',
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-wrap gap-1">
      {caps.map((cap) => (
        <Badge key={cap} variant="outline" className="text-[10px] font-normal text-muted-foreground">
          {cap}
        </Badge>
      ))}
    </div>
  );
}

function ConnectorCard({ connector }: { connector: ConnectorSummary }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const reset = useResetConnector(connector.channel);
  const visual = CHANNEL_VISUALS[connector.channel];
  const Icon = visual.icon;

  const handleDisconnect = async () => {
    try {
      await reset.mutateAsync();
      toast.success(`${connector.displayName} disconnected`);
    } catch (e) {
      toast.error('Failed to disconnect', { description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <Card className="flex flex-col transition-colors hover:border-primary/50">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between">
          <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${visual.iconBg} ${visual.iconColor}`}>
            <Icon className="h-6 w-6" />
          </div>
          <StatusBadge connector={connector} />
        </div>
        <div>
          <CardTitle className="text-base">{connector.displayName}</CardTitle>
          <CardDescription className="mt-1">{connector.description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="mt-auto space-y-3 pt-0">
        <CapabilityBadges connector={connector} />
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => router.push(`/connectors/${connector.channel}`)}
          >
            <Settings2 className="mr-2 h-4 w-4" />
            Configure
          </Button>
          <Button
            variant="outline"
            className="flex-1 text-destructive hover:text-destructive"
            disabled={!connector.configured || reset.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {reset.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Unplug className="mr-2 h-4 w-4" />
            )}
            Disconnect
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {connector.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the stored credentials for {connector.displayName}. You&apos;ll need to enter
              them again to reconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void handleDisconnect();
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function ConnectorsClient() {
  const { data: connectors, isLoading, error } = useConnectors();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Plug className="h-5 w-5" />
        </div>
        <PageHeaderTitle icon={Radio} title="Connectors" description="Store credentials for the platforms Claw will talk to." />
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-sm text-destructive">
            {error instanceof Error ? error.message : 'Failed to load connectors.'}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading
          ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-52 w-full rounded-xl" />)
          : (connectors ?? []).map((connector) => <ConnectorCard key={connector.channel} connector={connector} />)}
      </div>
    </div>
  );
}

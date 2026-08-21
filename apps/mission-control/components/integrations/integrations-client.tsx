'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plug, CheckCircle2, ExternalLink, Loader2, Puzzle, Settings2, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { BASE_PATH } from '@/lib/base-path';
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
import { useIntegrations, useDisconnectIntegration, type IntegrationSummary } from '@/hooks/use-integrations';
import { INTEGRATION_VISUALS } from './integration-visuals';

function StatusBadge({ integration }: { integration: IntegrationSummary }) {
  if (integration.accountCount === 0) {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground">
        Not connected
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 text-xs text-green-600 dark:text-green-500">
      <CheckCircle2 className="h-3 w-3" />
      {integration.accountMode === 'multi' && integration.accountCount > 1
        ? `${integration.accountCount} accounts connected`
        : 'Connected'}
    </Badge>
  );
}

function IntegrationCard({ integration }: { integration: IntegrationSummary }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const disconnect = useDisconnectIntegration(integration.name);
  const visual = INTEGRATION_VISUALS[integration.name];
  const Icon = visual.icon;

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      toast.success(`${integration.displayName} disconnected`);
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
          <StatusBadge integration={integration} />
        </div>
        <div>
          <CardTitle className="text-base">{integration.displayName}</CardTitle>
          <CardDescription className="mt-1">{integration.description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="mt-auto space-y-3 pt-0">
        <div className="flex gap-2">
          {integration.authMode === 'oauth' ? (
            <Button
              variant="outline"
              className="flex-1"
              nativeButton={false}
              // Raw <a>, not <Link> — this is a full-page nav to a route handler that
              // 302s to the provider. Next only applies basePath to <Link>, so the
              // prefix has to be explicit or the browser misses the route entirely.
              render={<a href={`${BASE_PATH}/api/integrations/${integration.name}/oauth/start`} />}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Connect
            </Button>
          ) : (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => router.push(`/integrations/${integration.name}`)}
            >
              <Settings2 className="mr-2 h-4 w-4" />
              Configure
            </Button>
          )}
          <Button
            variant="outline"
            className="flex-1 text-destructive hover:text-destructive"
            disabled={integration.accountCount === 0 || disconnect.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {disconnect.isPending ? (
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
            <AlertDialogTitle>Disconnect {integration.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              {integration.accountMode === 'multi' && integration.accountCount > 1
                ? `This removes all ${integration.accountCount} connected accounts. You'll need to reconnect each one.`
                : `This permanently deletes the stored credentials for ${integration.displayName}. You'll need to reconnect to use it again.`}
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

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  cancelled: 'Connection cancelled.',
  oauth_not_configured: 'This integration has not been configured by your administrator yet.',
  invalid_state: 'That connection attempt expired or was invalid — try again.',
  missing_code_or_state: "The provider didn't return the expected response — try again.",
  unauthenticated: 'Please sign in and try again.',
  unknown_integration: 'Unknown integration.',
  internal_error: 'Something went wrong — try again.',
};

/**
 * OAuth integrations have no detail page of their own — every outcome of the
 * /oauth/start and /oauth/callback routes lands back here with `connected`
 * (the integration name) or `error` (+ `integration`) on the URL. Toast once,
 * then strip the params so a refresh doesn't re-toast.
 */
function useOAuthRedirectToast(integrations: IntegrationSummary[] | undefined) {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const connected = searchParams.get('connected');
    const oauthError = searchParams.get('error');
    if (!connected && !oauthError) return;

    const name = connected ?? searchParams.get('integration');
    const displayName = integrations?.find((i) => i.name === name)?.displayName ?? name ?? 'Integration';
    if (connected) {
      toast.success(`${displayName} connected`);
    } else if (oauthError) {
      toast.error('Connection failed', { description: OAUTH_ERROR_MESSAGES[oauthError] ?? oauthError });
    }
    router.replace('/integrations');
    // Only meant to fire once for the redirect that landed on this page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrations]);
}

function IntegrationsClientInner() {
  const { data: integrations, isLoading, error } = useIntegrations();
  useOAuthRedirectToast(integrations);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Puzzle className="h-5 w-5" />
        </div>
        <PageHeaderTitle icon={Plug} title="Integrations" description="Connect external tools Claw can call directly — separate from the messaging channels under Connectors." />
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-sm text-destructive">
            {error instanceof Error ? error.message : 'Failed to load integrations.'}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)
          : (integrations ?? []).map((integration) => (
              <IntegrationCard key={integration.name} integration={integration} />
            ))}
      </div>
    </div>
  );
}

export function IntegrationsClient() {
  return (
    <Suspense fallback={<div className="grid gap-4 p-8 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
    </div>}>
      <IntegrationsClientInner />
    </Suspense>
  );
}

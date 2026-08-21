'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import Link from 'next/link';
import { toast } from 'sonner';
import { CheckCircle2, Link2, Unlink } from 'lucide-react';
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';
import { useWhatsAppAccounts } from '@/hooks/use-whatsapp-accounts';
import {
  useAgentWhatsAppChannel,
  useConnectWhatsAppChannel,
  useDisconnectWhatsAppChannel,
} from '@/hooks/use-agent-whatsapp-channel';

interface ChannelsTabProps {
  agentId: string;
}

export function ChannelsTab({ agentId }: ChannelsTabProps) {
  const { data: channelData, isLoading: channelLoading } = useAgentWhatsAppChannel(agentId);
  const { data: accounts, isLoading: accountsLoading } = useWhatsAppAccounts();
  const connect = useConnectWhatsAppChannel(agentId);
  const disconnect = useDisconnectWhatsAppChannel(agentId);

  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  const connectedAccount = channelData?.account ?? null;

  const availableAccounts = (accounts ?? []).filter(
    (a) => a.agentId === null || a.agentId === agentId,
  );

  const isLoading = channelLoading || accountsLoading;

  const handleConnect = async () => {
    if (!selectedAccountId) return;
    try {
      await connect.mutateAsync(selectedAccountId);
      setSelectedAccountId('');
      toast.success('WhatsApp account connected');
    } catch {
      toast.error('Failed to connect account');
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      setShowDisconnectDialog(false);
      toast.success('WhatsApp account disconnected');
    } catch {
      toast.error('Failed to disconnect account');
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 space-y-3">
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10 text-green-600">
              <WhatsAppIcon className="h-4 w-4" />
            </div>
            <div>
              <CardTitle>WhatsApp</CardTitle>
              <CardDescription>
                Connect a WhatsApp account so this agent replies to messages on that number.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {connectedAccount ? (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <div>
                  <p className="font-medium text-sm">{connectedAccount.displayName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-muted-foreground">{connectedAccount.displayPhone}</p>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {connectedAccount.provider}
                    </Badge>
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDisconnectDialog(true)}
                disabled={disconnect.isPending}
              >
                <Unlink className="h-3 w-3 mr-1" />
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {availableAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No WhatsApp accounts available. Connect one first in{' '}
                  <Link href="/settings/channels/whatsapp" className="underline">
                    Settings → Channels → WhatsApp
                  </Link>
                  .
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select a WhatsApp account" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.displayName}
                            <span className="ml-1 text-xs text-muted-foreground">
                              {account.displayPhone}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={handleConnect}
                      disabled={!selectedAccountId || connect.isPending}
                    >
                      <Link2 className="h-4 w-4 mr-1" />
                      Connect
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Accounts already connected to another agent are hidden.
                  </p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect WhatsApp account?</AlertDialogTitle>
            <AlertDialogDescription>
              This agent will stop receiving messages from{' '}
              <strong>{connectedAccount?.displayPhone}</strong>. The WhatsApp account itself
              will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDisconnect}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

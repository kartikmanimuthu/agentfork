'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';
import { ArrowLeft, Trash2, Settings, MessageSquare, Plus, Loader2 } from 'lucide-react';

interface WhatsAppAccount {
  id: string;
  phoneNumberId: string;
  displayPhone: string;
  displayName: string;
  status: string;
  qualityRating: string | null;
  messagingLimit: string | null;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  active: 'default',
  disconnected: 'destructive',
  pending: 'secondary',
};

export default function WhatsAppChannelsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<WhatsAppAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnectTarget, setDisconnectTarget] = useState<WhatsAppAccount | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [metaConfig, setMetaConfig] = useState<{ appId: string; apiVersion: string } | null>(null);
  const [fbReady, setFbReady] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const fetchAccounts = () => {
    setLoading(true);
    fetch('/api/whatsapp/accounts')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load accounts');
        return res.json();
      })
      .then((data) => {
        setAccounts(data ?? []);
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load WhatsApp accounts');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  // Load Meta config and Facebook SDK when connect dialog opens
  useEffect(() => {
    if (!connectOpen) return;

    fetch('/api/whatsapp/config')
      .then((res) => res.json())
      .then((config) => {
        setMetaConfig(config);
        loadFacebookSdk(config.appId, config.apiVersion);
      })
      .catch(() => {
        toast.error('Failed to load Meta configuration');
      });
  }, [connectOpen]);

  const loadFacebookSdk = (appId: string, version: string) => {
    if (typeof window === 'undefined') return;
    if ((window as any).FB) {
      setFbReady(true);
      return;
    }

    (window as any).fbAsyncInit = function () {
      (window as any).FB.init({
        appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: version.replace(/^v/, ''),
      });
      setFbReady(true);
    };

    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    document.body.appendChild(script);
  };

  const launchEmbeddedSignup = useCallback(() => {
    if (!(window as any).FB) {
      toast.error('Facebook SDK not loaded yet');
      return;
    }

    setConnecting(true);
    (window as any).FB.login(
      (response: any) => {
        if (response.authResponse?.code) {
          const code = response.authResponse.code;
          // Exchange code for account via our API
          fetch('/api/whatsapp/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
          })
            .then((res) => {
              if (!res.ok) throw new Error('Connection failed');
              return res.json();
            })
            .then(() => {
              toast.success('WhatsApp account connected successfully');
              setConnectOpen(false);
              fetchAccounts();
            })
            .catch(() => {
              toast.error('Failed to connect WhatsApp account');
            })
            .finally(() => setConnecting(false));
        } else {
          setConnecting(false);
          if (response.status !== 'unknown') {
            toast.error('Authorization was cancelled or failed');
          }
        }
      },
      {
        config_id: '', // Config ID should be set via environment/Meta Developer portal
        response_type: 'code',
        override_default_response_type: true,
        scope: 'whatsapp_business_messaging',
      }
    );
  }, []);

  const handleDisconnect = async (account: WhatsAppAccount) => {
    try {
      const res = await fetch('/api/whatsapp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: account.id }),
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      toast.success('Account disconnected');
      setDisconnectTarget(null);
    } catch {
      toast.error('Failed to disconnect account');
    }
  };

  const columns: ColumnDef<WhatsAppAccount>[] = useMemo(
    () => [
      {
        accessorKey: 'displayName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Display Name" />,
        cell: ({ row }) => {
          const account = row.original;
          return (
            <div className="flex items-center gap-2 font-medium">
              <WhatsAppIcon className="h-4 w-4 text-green-600 shrink-0" />
              <span>{account.displayName || '—'}</span>
            </div>
          );
        },
      },
      {
        accessorKey: 'displayPhone',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Phone Number" />,
        cell: ({ row }) => <span>{row.original.displayPhone}</span>,
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status] ?? 'outline'} className="capitalize">
            {row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: 'qualityRating',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Quality" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.qualityRating ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'messagingLimit',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Limit" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.messagingLimit ?? '—'}</span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => router.push(`/settings/channels/whatsapp/${row.original.id}/routing`)}
              aria-label="Routing"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => router.push(`/settings/channels/whatsapp/${row.original.id}/templates`)}
              aria-label="Templates"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => setDisconnectTarget(row.original)}
              aria-label="Disconnect"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10 text-green-600">
            <WhatsAppIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">WhatsApp Channels</h2>
            <p className="text-sm text-muted-foreground">Connect and manage WhatsApp Business accounts.</p>
          </div>
        </div>
        <Link href="/connectors">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Connectors
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle>Connected Accounts</CardTitle>
            <CardDescription>
              {loading ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                `${accounts.length} account${accounts.length !== 1 ? 's' : ''}`
              )}
            </CardDescription>
          </div>
          <Button onClick={() => setConnectOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Connect Account
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={accounts}
              loading={false}
              enablePagination
              enableSorting
              enableFiltering={false}
              defaultPageSize={25}
              emptyMessage="No WhatsApp accounts connected. Connect your first account to get started."
            />
          )}
        </CardContent>
      </Card>

      {/* Connect Account Dialog */}
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect WhatsApp Account</DialogTitle>
            <DialogDescription>
              Use Meta Embedded Signup to connect your WhatsApp Business account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!fbReady ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10 text-green-600">
                      <WhatsAppIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Meta Embedded Signup</p>
                      <p className="text-xs text-muted-foreground">App ID: {metaConfig?.appId}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    You will be redirected to Meta to authorize access to your WhatsApp Business account.
                  </p>
                </div>
                <Button
                  className="w-full"
                  size="lg"
                  onClick={launchEmbeddedSignup}
                  disabled={connecting}
                >
                  {connecting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <WhatsAppIcon className="mr-2 h-4 w-4" />
                      Launch Meta Embedded Signup
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectOpen(false)} disabled={connecting}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disconnect Confirmation */}
      <AlertDialog open={!!disconnectTarget} onOpenChange={(open) => !open && setDisconnectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will disconnect {disconnectTarget?.displayPhone ?? 'this account'} from the platform.
              Messages will no longer be received or sent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDisconnectTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => disconnectTarget && handleDisconnect(disconnectTarget)}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

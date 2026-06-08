'use client';

import { useEffect, useState, useMemo } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Trash2, MessageSquare, Plus, Loader2, Send } from 'lucide-react';

interface TelegramAccount {
  id: string;
  botName: string | null;
  botUsername: string | null;
  status: string;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  active: 'default',
  disconnected: 'destructive',
  pending: 'secondary',
};

export default function TelegramChannelsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<TelegramAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnectTarget, setDisconnectTarget] = useState<TelegramAccount | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [botName, setBotName] = useState('');

  const fetchAccounts = () => {
    setLoading(true);
    fetch('/api/telegram/accounts')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load accounts');
        return res.json();
      })
      .then((data) => {
        setAccounts(data ?? []);
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load Telegram accounts');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleConnect = async () => {
    if (!botToken.trim()) {
      toast.error('Bot token is required');
      return;
    }
    setConnecting(true);
    try {
      const res = await fetch('/api/telegram/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: botToken.trim(), name: botName.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Connection failed');
      }
      toast.success('Telegram bot connected successfully');
      setConnectOpen(false);
      setBotToken('');
      setBotName('');
      fetchAccounts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to connect Telegram bot');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (account: TelegramAccount) => {
    try {
      const res = await fetch('/api/telegram/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: account.id }),
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      toast.success('Bot disconnected');
      setDisconnectTarget(null);
    } catch {
      toast.error('Failed to disconnect bot');
    }
  };

  const columns: ColumnDef<TelegramAccount>[] = useMemo(
    () => [
      {
        accessorKey: 'botName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bot Name" />,
        cell: ({ row }) => {
          const account = row.original;
          return (
            <div className="flex items-center gap-2 font-medium">
              <Send className="h-4 w-4 text-sky-600 shrink-0" />
              <span>{account.botName || '—'}</span>
            </div>
          );
        },
      },
      {
        accessorKey: 'botUsername',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Username" />,
        cell: ({ row }) => <span>{row.original.botUsername ? `@${row.original.botUsername}` : '—'}</span>,
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
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
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
    []
  );

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600">
            <Send className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Telegram Channels</h2>
            <p className="text-sm text-muted-foreground">Connect and manage Telegram bots.</p>
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
            <CardTitle>Connected Bots</CardTitle>
            <CardDescription>
              {loading ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                `${accounts.length} bot${accounts.length !== 1 ? 's' : ''}`
              )}
            </CardDescription>
          </div>
          <Button onClick={() => setConnectOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Connect Bot
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
              emptyMessage="No Telegram bots connected. Connect your first bot to get started."
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Telegram Bot</DialogTitle>
            <DialogDescription>
              Paste your BotFather token to connect a Telegram bot.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-1.5">
              <Label htmlFor="botToken">Bot Token</Label>
              <Input
                id="botToken"
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              />
              <p className="text-xs text-muted-foreground">Get this from @BotFather on Telegram.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="botName">Display Name (optional)</Label>
              <Input
                id="botName"
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                placeholder="My Support Bot"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectOpen(false)} disabled={connecting}>
              Cancel
            </Button>
            <Button onClick={handleConnect} disabled={connecting}>
              {connecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Connect'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!disconnectTarget} onOpenChange={(open) => !open && setDisconnectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect bot?</AlertDialogTitle>
            <AlertDialogDescription>
              This will disconnect {disconnectTarget?.botName ?? 'this bot'} from the platform.
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

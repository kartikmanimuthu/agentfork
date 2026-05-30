'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';
import { ArrowLeft, RefreshCw } from 'lucide-react';

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
}

export default function TemplatesPage({ params }: { params: Promise<{ id: string }> }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    params.then(({ id }) => {
      setAccountId(id);
      fetchTemplates(id);
    });
  }, [params]);

  const fetchTemplates = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/accounts/${id}/templates`);
      if (!res.ok) throw new Error('Failed to load templates');
      const data = await res.json();
      setTemplates(data ?? []);
    } catch {
      toast.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    if (!accountId) return;
    setSyncing(true);
    try {
      const res = await fetch(`/api/whatsapp/accounts/${accountId}/templates/sync`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to sync');
      toast.success('Templates synced from Meta');
      fetchTemplates(accountId);
    } catch {
      toast.error('Failed to sync templates');
    } finally {
      setSyncing(false);
    }
  };

  const columns: ColumnDef<Template>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: 'language',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Language" />,
        cell: ({ row }) => <span className="uppercase">{row.original.language}</span>,
      },
      {
        accessorKey: 'category',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
        cell: ({ row }) => (
          <Badge variant="outline" className="capitalize">
            {row.original.category}
          </Badge>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Badge variant={row.original.status === 'APPROVED' ? 'default' : 'secondary'} className="capitalize">
            {row.original.status.toLowerCase()}
          </Badge>
        ),
      },
    ],
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
            <h2 className="text-2xl font-bold tracking-tight">Message Templates</h2>
            <p className="text-sm text-muted-foreground">Manage WhatsApp message templates.</p>
          </div>
        </div>
        <Link href="/connectors/whatsapp">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to WhatsApp
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle>Templates</CardTitle>
            <CardDescription>
              {loading ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                `${templates.length} template${templates.length !== 1 ? 's' : ''}`
              )}
            </CardDescription>
          </div>
          <Button onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync from Meta'}
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
              data={templates}
              loading={false}
              enablePagination
              enableSorting
              enableFiltering={false}
              defaultPageSize={25}
              emptyMessage="No templates found. Sync from Meta to import templates."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

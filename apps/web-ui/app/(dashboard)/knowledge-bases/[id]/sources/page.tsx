'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ArrowLeft,
  Plus,
  RefreshCw,
  Play,
  Trash2,
  AlertCircle,
  Link2,
  Globe,
  Database,
  Plug,
} from 'lucide-react';

interface DataSource {
  id: string;
  knowledgeBaseId: string;
  type: 'FILE' | 'URL' | 'CONNECTOR';
  config: Record<string, unknown>;
  status: 'active' | 'syncing' | 'error' | 'disabled';
  lastSyncAt: string | null;
  syncSchedule: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

const TYPE_BADGES: Record<
  DataSource['type'],
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; icon: React.ElementType }
> = {
  FILE: { label: 'FILE', variant: 'secondary', icon: Database },
  URL: { label: 'URL', variant: 'default', icon: Globe },
  CONNECTOR: { label: 'CONNECTOR', variant: 'outline', icon: Plug },
};

const STATUS_BADGES: Record<
  DataSource['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  active: 'default',
  syncing: 'secondary',
  error: 'destructive',
  disabled: 'outline',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export default function KnowledgeBaseSourcesPage() {
  const { id } = useParams<{ id: string }>();
  const [sources, setSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSources = useCallback(() => {
    setLoading(true);
    fetch(`/api/knowledge-bases/${id}/sources?limit=50`)
      .then((res) => res.json())
      .then((data) => {
        setSources(data.items ?? []);
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load sources');
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    loadSources();
  }, [id, loadSources]);

  const handleSync = async (sourceId: string) => {
    try {
      const res = await fetch(`/api/knowledge-bases/${id}/sources/${sourceId}/sync`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Sync failed');
      toast.success('Sync queued');
    } catch {
      toast.error('Failed to queue sync');
    }
  };

  const handleDelete = async (sourceId: string) => {
    if (!confirm('Are you sure you want to delete this source?')) return;
    try {
      const res = await fetch(`/api/knowledge-bases/${id}/sources/${sourceId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Delete failed');
      setSources((prev) => prev.filter((s) => s.id !== sourceId));
      toast.success('Source deleted');
    } catch {
      toast.error('Failed to delete source');
    }
  };

  const columns: ColumnDef<DataSource>[] = [
    {
      accessorKey: 'type',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
      cell: ({ row }) => {
        const type = row.original.type;
        const cfg = TYPE_BADGES[type];
        const Icon = cfg.icon;
        return (
          <Badge variant={cfg.variant}>
            <Icon className="h-3 w-3 mr-1" />
            {cfg.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => (
        <Badge variant={STATUS_BADGES[row.original.status] ?? 'outline'}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: 'lastSyncAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Last Sync" />,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{formatDate(row.original.lastSyncAt)}</span>
      ),
    },
    {
      accessorKey: 'syncSchedule',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Schedule" />,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.syncSchedule ?? 'Manual'}
        </span>
      ),
    },
    {
      accessorKey: 'errorMessage',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Error" />,
      cell: ({ row }) => {
        const msg = row.original.errorMessage;
        if (!msg) return <span className="text-muted-foreground">—</span>;
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <div className="flex items-center gap-1 text-destructive max-w-[200px] truncate cursor-help">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="truncate text-xs">{msg}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">{msg}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          {row.original.type === 'URL' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => handleSync(row.original.id)}
              aria-label="Sync now"
            >
              <Play className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive"
            onClick={() => handleDelete(row.original.id)}
            aria-label="Delete source"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href={`/knowledge-bases/${id}`}
            aria-label="Back"
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Link2 className="h-5 w-5" />
          <h2 className="text-2xl font-bold tracking-tight">Sources</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={loadSources} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Link href={`/knowledge-bases/${id}/sources/new`} className={buttonVariants()}>
            <Plus className="h-4 w-4 mr-2" />
            Add Source
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Data Sources</CardTitle>
          <CardDescription>
            {loading ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              `${sources.length} source${sources.length !== 1 ? 's' : ''}`
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={sources}
              loading={false}
              enablePagination
              enableSorting
              enableFiltering={false}
              defaultPageSize={25}
              emptyMessage="No sources yet. Add a data source to get started."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

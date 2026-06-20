'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
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
import { Users, Plus, Trash2, Pencil, ExternalLink, RefreshCw } from 'lucide-react';
import { AnnotationQueueDialog, type AnnotationQueueForDialog } from '@/components/evaluation/annotation-queue-dialog';

interface QueueRow {
  id: string;
  name: string;
  description: string | null;
  targetType: string;
  isActive: boolean;
  scoreConfig: { id: string; name: string; dataType: string } | null;
  _count: { items: number };
}

export default function AnnotationQueuesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editQueue, setEditQueue] = useState<QueueRow | null>(null);
  const [disableTarget, setDisableTarget] = useState<QueueRow | null>(null);

  const { data, isLoading } = useQuery<{ queues: QueueRow[] }>({
    queryKey: ['eval-annotation-queues'],
    queryFn: async () => (await fetch('/api/evaluation/annotation-queues')).json(),
  });

  const populate = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/evaluation/annotation-queues/${id}/populate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 100 }),
      });
      if (!res.ok) throw new Error('Failed to populate queue');
      return res.json();
    },
    onSuccess: (res) => toast.success(`Populated ${res.count} items`),
    onError: (e: Error) => toast.error(e.message),
  });

  const disable = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/evaluation/annotation-queues/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to disable queue');
    },
    onSuccess: () => {
      toast.success('Queue disabled');
      setDisableTarget(null);
      qc.invalidateQueries({ queryKey: ['eval-annotation-queues'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ColumnDef<QueueRow>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <div>
            <span className="font-medium">{row.original.name}</span>
            {row.original.description && <p className="text-xs text-muted-foreground">{row.original.description}</p>}
          </div>
        ),
      },
      {
        accessorKey: 'targetType',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Target" />,
        cell: ({ row }) => <Badge variant="outline">{row.original.targetType}</Badge>,
      },
      {
        accessorKey: 'scoreConfig',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Score config" />,
        accessorFn: (row) => row.scoreConfig?.name ?? '',
        cell: ({ row }) => <span>{row.original.scoreConfig?.name ?? '—'}</span>,
      },
      {
        id: 'items',
        header: 'Items',
        cell: ({ row }) => <span>{row.original._count?.items ?? 0}</span>,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => router.push(`/evaluation/annotation-queues/${row.original.id}`)} title="Review">
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => { setEditQueue(row.original); setDialogOpen(true); }} title="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => populate.mutate(row.original.id)} title="Populate">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setDisableTarget(row.original)} title="Disable">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ),
      },
    ],
    [populate],
  );

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-6 w-6" />
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Annotation Queues</h2>
            <p className="text-muted-foreground">Review and score targets manually.</p>
          </div>
        </div>
        <Button onClick={() => { setEditQueue(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> New queue
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Queues</CardTitle>
          <CardDescription>Create queues and populate them with unscored targets.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={data?.queues ?? []} loading={isLoading} />
        </CardContent>
      </Card>

      <AnnotationQueueDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => qc.invalidateQueries({ queryKey: ['eval-annotation-queues'] })}
        queue={editQueue ? { id: editQueue.id, name: editQueue.name, description: editQueue.description, scoreConfigId: editQueue.scoreConfig?.id ?? '', targetType: editQueue.targetType } : null}
      />

      <AlertDialog open={!!disableTarget} onOpenChange={(open) => !open && setDisableTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable queue?</AlertDialogTitle>
            <AlertDialogDescription>Existing items and scores are preserved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDisableTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => disableTarget && disable.mutate(disableTarget.id)}>Disable</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

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
import { FlaskConical, Plus, Trash2, ExternalLink, Play } from 'lucide-react';
import { ExperimentDialog } from '@/components/evaluation/experiment-dialog';

interface ExperimentRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  dataset: { id: string; name: string } | null;
  agentVersionIds: string[];
  _count: { runItems: number };
}

export default function ExperimentsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExperimentRow | null>(null);

  const { data, isLoading } = useQuery<{ experiments: ExperimentRow[] }>({
    queryKey: ['eval-experiments'],
    queryFn: async () => (await fetch('/api/evaluation/experiments')).json(),
  });

  const run = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/evaluation/experiments/${id}/run`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to enqueue experiment run');
    },
    onSuccess: () => {
      toast.success('Experiment run queued');
      qc.invalidateQueries({ queryKey: ['eval-experiments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/evaluation/experiments/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete experiment');
    },
    onSuccess: () => {
      toast.success('Experiment deleted');
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['eval-experiments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ColumnDef<ExperimentRow>[] = useMemo(
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
        accessorKey: 'dataset',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Dataset" />,
        accessorFn: (row) => row.dataset?.name ?? '',
        cell: ({ row }) => <span>{row.original.dataset?.name ?? '—'}</span>,
      },
      {
        accessorKey: 'agentVersionIds',
        header: 'Versions',
        cell: ({ row }) => <div className="flex gap-1 flex-wrap">{row.original.agentVersionIds.map((id, i) => <Badge key={id} variant="outline">{id.slice(-6)} {i === 0 && '(latest)'}</Badge>)}</div>,
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <Badge variant={row.original.status === 'RUNNING' ? 'default' : row.original.status === 'COMPLETED' ? 'secondary' : 'outline'}>{row.original.status}</Badge>,
      },
      {
        id: 'items',
        header: 'Run items',
        cell: ({ row }) => <span>{row.original._count?.runItems ?? 0}</span>,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => router.push(`/evaluation/experiments/${row.original.id}`)} title="View">
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => run.mutate(row.original.id)} disabled={row.original.status === 'RUNNING'} title="Run">
              <Play className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(row.original)} title="Delete">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ),
      },
    ],
    [run],
  );

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-6 w-6" />
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Experiments</h2>
            <p className="text-muted-foreground">Run datasets against agent versions and compare outputs.</p>
          </div>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> New experiment
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Experiments</CardTitle>
          <CardDescription>Compare agent versions on a shared dataset.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={data?.experiments ?? []} loading={isLoading} />
        </CardContent>
      </Card>

      <ExperimentDialog open={dialogOpen} onOpenChange={setDialogOpen} onSaved={() => qc.invalidateQueries({ queryKey: ['eval-experiments'] })} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete experiment?</AlertDialogTitle>
            <AlertDialogDescription>This will delete the experiment and all run items.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

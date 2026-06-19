'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Database, Plus, Search, Eye, Pencil, Trash2 } from 'lucide-react';
import { DatasetDialog, type DatasetForDialog } from '@/components/evaluation/dataset-dialog';

interface DatasetRow {
  id: string;
  name: string;
  description: string | null;
  _count?: { items: number };
  updatedAt: string;
  createdAt: string;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function DatasetsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ datasets: DatasetRow[] }>({
    queryKey: ['eval-datasets'],
    queryFn: async () => (await fetch('/api/evaluation/datasets')).json(),
  });

  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DatasetForDialog | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const del = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/evaluation/datasets/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete dataset');
    },
    onSuccess: () => {
      toast.success('Dataset deleted');
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['eval-datasets'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const datasets = data?.datasets ?? [];
  const filtered = useMemo(() => {
    if (!search) return datasets;
    const term = search.toLowerCase();
    return datasets.filter(
      (d) => d.name.toLowerCase().includes(term) || (d.description ?? '').toLowerCase().includes(term)
    );
  }, [datasets, search]);

  const openCreate = () => {
    setEditTarget(null);
    setDialogOpen(true);
  };

  const columns: ColumnDef<DatasetRow>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <button
            className="flex items-center gap-2 font-medium hover:underline text-left"
            onClick={() => router.push(`/evaluation/datasets/${row.original.id}`)}
          >
            <Database className="h-4 w-4 text-muted-foreground shrink-0" />
            <span>{row.original.name}</span>
          </button>
        ),
      },
      {
        accessorKey: 'description',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground line-clamp-1">{row.original.description ?? '—'}</span>
        ),
      },
      {
        id: 'items',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Items" />,
        accessorFn: (row) => row._count?.items ?? 0,
        cell: ({ row }) => <span>{row.original._count?.items ?? 0}</span>,
      },
      {
        accessorKey: 'updatedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" />,
        cell: ({ row }) => <span className="text-muted-foreground">{formatDate(row.original.updatedAt)}</span>,
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
              onClick={() => router.push(`/evaluation/datasets/${row.original.id}`)}
              aria-label="View dataset"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setEditTarget(row.original);
                setDialogOpen(true);
              }}
              aria-label="Edit dataset"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => setDeleteTarget(row.original.id)}
              aria-label="Delete dataset"
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

  const header = (
    <div className="flex items-center justify-between gap-4">
      <div className="relative w-full max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search datasets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 w-full"
        />
      </div>
      <Button onClick={openCreate}>
        <Plus className="h-4 w-4 mr-2" /> New dataset
      </Button>
    </div>
  );

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center gap-2">
        <Database className="h-6 w-6" />
        <h2 className="text-3xl font-bold tracking-tight">Datasets</h2>
      </div>
      <p className="text-muted-foreground">Curated collections of evaluation items.</p>

      <Card>
        <CardHeader>
          <CardTitle>Datasets</CardTitle>
          <CardDescription>{filtered.length} dataset{filtered.length !== 1 ? 's' : ''}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={filtered}
            loading={isLoading}
            enableFiltering={false}
            defaultPageSize={25}
            emptyMessage="No datasets yet. Create your first dataset to get started."
            header={header}
          />
        </CardContent>
      </Card>

      <DatasetDialog open={dialogOpen} onOpenChange={setDialogOpen} dataset={editTarget} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete dataset?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The dataset and all its items will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && del.mutate(deleteTarget)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

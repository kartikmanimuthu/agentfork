'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
import { ClipboardCheck, Plus, Trash2, Pencil, Eye, Archive } from 'lucide-react';
import { ScoreConfigDialog, type ScoreConfigForDialog } from '@/components/evaluation/score-config-dialog';

interface ScoreConfig {
  id: string;
  name: string;
  description: string | null;
  dataType: 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN';
  minValue: number | null;
  maxValue: number | null;
  categories: { label: string; value: number }[] | null;
  isArchived: boolean;
}
interface ScoreRow {
  id: string;
  targetType: string;
  numericValue: number | null;
  stringValue: string | null;
  source: string;
  comment: string | null;
  createdAt: string;
  config: { name: string; dataType: string };
  messageId: string | null;
  sessionId: string | null;
  executionId: string | null;
}

export default function ScoresPage() {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-6 w-6" />
        <h2 className="text-3xl font-bold tracking-tight">Evaluation Scores</h2>
      </div>
      <p className="text-muted-foreground">Grade real conversations and manage your score definitions.</p>

      <Tabs defaultValue="scores" className="space-y-4">
        <TabsList>
          <TabsTrigger value="scores">Scores</TabsTrigger>
          <TabsTrigger value="configs">Score Configs</TabsTrigger>
        </TabsList>
        <TabsContent value="scores">
          <ScoresTab />
        </TabsContent>
        <TabsContent value="configs">
          <ConfigsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function targetHref(s: ScoreRow): string | null {
  if (s.executionId) return `/inferences/${s.executionId}`;
  if (s.sessionId) return `/sessions/${s.sessionId}`;
  return null;
}

function ScoresTab() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ scores: ScoreRow[] }>({
    queryKey: ['eval-scores'],
    queryFn: async () => (await fetch('/api/evaluation/scores')).json(),
  });
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const del = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/evaluation/scores/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete score');
    },
    onSuccess: () => {
      toast.success('Score deleted');
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['eval-scores'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ColumnDef<ScoreRow>[] = useMemo(
    () => [
      {
        accessorKey: 'config',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Config" />,
        accessorFn: (row) => row.config?.name ?? '',
        cell: ({ row }) => <span className="font-medium">{row.original.config?.name}</span>,
      },
      {
        id: 'value',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Value" />,
        accessorFn: (row) => row.stringValue ?? row.numericValue ?? '',
        cell: ({ row }) => <span>{row.original.stringValue ?? row.original.numericValue}</span>,
      },
      {
        accessorKey: 'targetType',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Target" />,
        cell: ({ row }) => <Badge variant="outline">{row.original.targetType}</Badge>,
      },
      {
        accessorKey: 'source',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
        cell: ({ row }) => (
          <Badge variant={row.original.source === 'API' ? 'secondary' : 'default'}>{row.original.source}</Badge>
        ),
      },
      {
        accessorKey: 'comment',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Comment" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground line-clamp-1 max-w-xs">{row.original.comment ?? '—'}</span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const href = targetHref(row.original);
          return (
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!href}
                onClick={() => href && router.push(href)}
                aria-label="View scored trace"
              >
                <Eye className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() => setDeleteTarget(row.original.id)}
                aria-label="Delete score"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scores</CardTitle>
        <CardDescription>Manual and API-ingested evaluation scores across your traces.</CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={data?.scores ?? []}
          loading={isLoading}
          enableFiltering={false}
          defaultPageSize={25}
          emptyMessage="No scores yet. Score a conversation or execution from its detail page."
        />
      </CardContent>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete score?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
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
    </Card>
  );
}

function ConfigsTab() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ configs: ScoreConfig[] }>({
    queryKey: ['eval-score-configs'],
    queryFn: async () => (await fetch('/api/evaluation/score-configs')).json(),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ScoreConfigForDialog | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/evaluation/score-configs/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to archive config');
    },
    onSuccess: () => {
      toast.success('Config archived');
      setArchiveTarget(null);
      qc.invalidateQueries({ queryKey: ['eval-score-configs'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openCreate = () => {
    setEditTarget(null);
    setDialogOpen(true);
  };
  const openEdit = (c: ScoreConfig) => {
    setEditTarget(c);
    setDialogOpen(true);
  };

  const columns: ColumnDef<ScoreConfig>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <button
            className="font-medium hover:underline text-left"
            onClick={() => router.push(`/evaluation/scores/configs/${row.original.id}`)}
          >
            {row.original.name}
          </button>
        ),
      },
      {
        accessorKey: 'dataType',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => <Badge variant="outline">{row.original.dataType}</Badge>,
      },
      {
        id: 'range',
        header: () => <span>Range / Categories</span>,
        cell: ({ row }) => {
          const c = row.original;
          return (
            <span className="text-muted-foreground">
              {c.dataType === 'NUMERIC'
                ? `${c.minValue ?? '−∞'} … ${c.maxValue ?? '∞'}`
                : c.dataType === 'CATEGORICAL'
                  ? (c.categories ?? []).map((x) => x.label).join(', ')
                  : 'true / false'}
            </span>
          );
        },
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
              onClick={() => router.push(`/evaluation/scores/configs/${row.original.id}`)}
              aria-label="View config"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => openEdit(row.original)}
              aria-label="Edit config"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => setArchiveTarget(row.original.id)}
              aria-label="Archive config"
            >
              <Archive className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const header = (
    <div className="flex justify-end">
      <Button onClick={openCreate}>
        <Plus className="h-4 w-4 mr-2" /> New config
      </Button>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Score configs</CardTitle>
        <CardDescription>Reusable definitions for how traces are graded.</CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={data?.configs ?? []}
          loading={isLoading}
          enableFiltering={false}
          defaultPageSize={25}
          emptyMessage="No score configs yet. Create one to start grading traces."
          header={header}
        />
      </CardContent>

      <ScoreConfigDialog open={dialogOpen} onOpenChange={setDialogOpen} config={editTarget} />

      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive config?</AlertDialogTitle>
            <AlertDialogDescription>
              The config will be hidden from new scoring. Existing scores are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setArchiveTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => archiveTarget && archive.mutate(archiveTarget)}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

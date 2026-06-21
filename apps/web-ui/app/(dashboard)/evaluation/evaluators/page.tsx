'use client';

import { useMemo, useState } from 'react';
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
import { Bot, Plus, Trash2, Pencil, Play } from 'lucide-react';
import { EvaluatorDialog, type EvaluatorForDialog } from '@/components/evaluation/evaluator-dialog';

interface EvaluatorRow {
  id: string;
  name: string;
  description: string | null;
  prompt: string;
  model: string | null;
  temperature: number | null;
  maxTokens: number | null;
  isActive: boolean;
  scoreConfigId: string;
  scoreConfig: { id: string; name: string; dataType: string } | null;
}

export default function EvaluatorsPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editEvaluator, setEditEvaluator] = useState<EvaluatorForDialog | null>(null);
  const [disableTarget, setDisableTarget] = useState<EvaluatorRow | null>(null);

  const { data, isLoading } = useQuery<{ evaluators: EvaluatorRow[] }>({
    queryKey: ['eval-evaluators'],
    queryFn: async () => (await fetch('/api/evaluation/evaluators')).json(),
  });

  const disable = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/evaluation/evaluators/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to disable evaluator');
    },
    onSuccess: () => {
      toast.success('Evaluator disabled');
      setDisableTarget(null);
      qc.invalidateQueries({ queryKey: ['eval-evaluators'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const run = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/evaluation/evaluators/${id}/run?limit=100`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to enqueue evaluator run');
    },
    onSuccess: () => toast.success('Evaluator run queued'),
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ColumnDef<EvaluatorRow>[] = useMemo(
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
        accessorKey: 'scoreConfig',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Score config" />,
        accessorFn: (row) => row.scoreConfig?.name ?? '',
        cell: ({ row }) => <span>{row.original.scoreConfig?.name ?? '—'}</span>,
      },
      {
        id: 'settings',
        header: 'Settings',
        cell: ({ row }) => (
          <div className="flex gap-1">
            {row.original.model && <Badge variant="outline">{row.original.model}</Badge>}
            {row.original.temperature != null && <Badge variant="outline">T {row.original.temperature}</Badge>}
          </div>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => { setEditEvaluator(row.original); setDialogOpen(true); }} title="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => run.mutate(row.original.id)} title="Run">
              <Play className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setDisableTarget(row.original)} title="Disable">
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
          <Bot className="h-6 w-6" />
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Evaluators</h2>
            <p className="text-muted-foreground">LLM-as-judge scoring configs.</p>
          </div>
        </div>
        <Button onClick={() => { setEditEvaluator(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> New evaluator
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Evaluators</CardTitle>
          <CardDescription>Configure automated scoring and run them against recent messages.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={data?.evaluators ?? []} loading={isLoading} />
        </CardContent>
      </Card>

      <EvaluatorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => qc.invalidateQueries({ queryKey: ['eval-evaluators'] })}
        evaluator={editEvaluator}
      />

      <AlertDialog open={!!disableTarget} onOpenChange={(open) => !open && setDisableTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable evaluator?</AlertDialogTitle>
            <AlertDialogDescription>
              This will set the evaluator to inactive. Existing scores are preserved.
            </AlertDialogDescription>
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

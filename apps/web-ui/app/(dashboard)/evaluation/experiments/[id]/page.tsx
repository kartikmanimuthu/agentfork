'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import { ChevronLeft, Play } from 'lucide-react';
import { ColumnDef } from '@tanstack/react-table';

interface ExperimentDetail {
  id: string;
  name: string;
  description: string | null;
  status: string;
  dataset: { id: string; name: string; _count: { items: number } } | null;
  agentVersionIds: string[];
  runItems: RunItemRow[];
}

interface RunItemRow {
  id: string;
  status: string;
  agentVersionId: string;
  agentVersion: { version: number; agentId: string } | null;
  datasetItem: { input: unknown } | null;
  outputText: string | null;
  latencyMs: number | null;
  error: string | null;
}

export default function ExperimentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params.id);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ experiment: ExperimentDetail }>({
    queryKey: ['eval-experiment', id],
    queryFn: async () => (await fetch(`/api/evaluation/experiments/${id}`)).json(),
  });

  const run = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/evaluation/experiments/${id}/run`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to enqueue experiment run');
    },
    onSuccess: () => {
      toast.success('Experiment run queued');
      qc.invalidateQueries({ queryKey: ['eval-experiment', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const experiment = data?.experiment;
  const total = experiment?.dataset?._count?.items ?? 0;
  const completed = experiment?.runItems?.filter((r) => r.status === 'COMPLETED').length ?? 0;
  const failed = experiment?.runItems?.filter((r) => r.status === 'FAILED').length ?? 0;
  const progress = total === 0 ? 0 : Math.round(((completed + failed) / total) * 100);

  const columns: ColumnDef<RunItemRow>[] = useMemo(
    () => [
      {
        accessorKey: 'datasetItem',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Input" />,
        cell: ({ row }) => <span className="font-mono text-xs truncate max-w-[200px] block">{JSON.stringify(row.original.datasetItem?.input ?? '').slice(0, 80)}</span>,
      },
      {
        accessorKey: 'agentVersion',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Version" />,
        cell: ({ row }) => <span>v{row.original.agentVersion?.version} ({row.original.agentVersionId.slice(-6)})</span>,
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <Badge variant={row.original.status === 'COMPLETED' ? 'secondary' : row.original.status === 'FAILED' ? 'destructive' : 'outline'}>{row.original.status}</Badge>,
      },
      {
        accessorKey: 'outputText',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Output" />,
        cell: ({ row }) => <span className="text-xs truncate max-w-[300px] block">{row.original.outputText ?? row.original.error ?? '—'}</span>,
      },
      {
        accessorKey: 'latencyMs',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Latency" />,
        cell: ({ row }) => <span>{row.original.latencyMs ? `${row.original.latencyMs}ms` : '—'}</span>,
      },
    ],
    [],
  );

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => router.push('/evaluation/experiments')}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex-1">
          <h2 className="text-3xl font-bold tracking-tight">{experiment?.name ?? 'Experiment'}</h2>
          <p className="text-muted-foreground">{experiment?.description}</p>
        </div>
        <Button onClick={() => run.mutate()} disabled={run.isPending || experiment?.status === 'RUNNING'}>
          <Play className="h-4 w-4 mr-2" /> Run
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Progress
            <Badge variant="outline">{experiment?.status}</Badge>
          </CardTitle>
          <CardDescription>
            Dataset: {experiment?.dataset?.name ?? '—'} · {completed} completed · {failed} failed · {total} items
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={progress} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run items</CardTitle>
          <CardDescription>Raw outputs per dataset item and agent version.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={experiment?.runItems ?? []} loading={isLoading} />
        </CardContent>
      </Card>
    </div>
  );
}

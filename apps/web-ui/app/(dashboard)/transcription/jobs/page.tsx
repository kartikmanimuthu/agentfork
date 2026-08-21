'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import { AudioLines, Plus, Search, Trash2, Pencil, Play } from 'lucide-react';
import { CreateJobDialog } from '@/components/transcription-jobs/create-job-dialog';
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
import { useTranscriptionJobConfigs, useDeleteTranscriptionJobConfig, type TranscriptionJobConfig } from '@/hooks/use-transcription-job-configs';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  draft: 'secondary',
  archived: 'outline',
};

export default function TranscriptionJobsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const providerFromQuery = searchParams.get('provider') ?? undefined;
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(Boolean(providerFromQuery));
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { data, isLoading } = useTranscriptionJobConfigs(search);
  const deleteMutation = useDeleteTranscriptionJobConfig();

  useEffect(() => {
    if (providerFromQuery) setDialogOpen(true);
  }, [providerFromQuery]);

  const jobs = useMemo(() => data?.items ?? [], [data]);

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id, {
      onSuccess: () => {
        toast.success('Job deleted');
        setDeleteTarget(null);
      },
      onError: () => toast.error('Failed to delete job'),
    });
  };

  const columns: ColumnDef<TranscriptionJobConfig>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => {
          const job = row.original;
          return (
            <button
              className="flex items-center gap-2 font-medium hover:underline text-left"
              onClick={() => router.push(`/transcription/jobs/${job.id}`)}
            >
              <AudioLines className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>{job.name}</span>
            </button>
          );
        },
      },
      {
        accessorKey: 'description',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground line-clamp-1">
            {row.original.description ?? '—'}
          </span>
        ),
      },
      {
        id: 'model',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Model" />,
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.model?.name ?? 'Default'}</Badge>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status] ?? 'secondary'} className="capitalize">
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
              className="h-8 w-8"
              onClick={() => router.push(`/transcription/jobs/${row.original.id}/playground`)}
              aria-label="Open playground"
            >
              <Play className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => router.push(`/transcription/jobs/${row.original.id}/edit`)}
              aria-label="Edit job"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => setDeleteTarget(row.original.id)}
              aria-label="Delete job"
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
          placeholder="Search jobs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 w-full"
        />
      </div>
      <Button onClick={() => setDialogOpen(true)}>
        <Plus className="h-4 w-4 mr-2" />
        New Job
      </Button>
    </div>
  );

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center gap-2">
        <AudioLines className="h-6 w-6" />
        <h2 className="text-3xl font-bold tracking-tight">Jobs</h2>
      </div>
      <p className="text-muted-foreground">Create reusable transcription jobs. Each job selects a model, maintains versions, owns API keys, and has its own playground.</p>

      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
          <CardDescription>
            {isLoading ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              `${jobs.length} job${jobs.length !== 1 ? 's' : ''}`
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={jobs}
              loading={false}
              enablePagination
              enableSorting
              enableFiltering={false}
              defaultPageSize={25}
              emptyMessage="No jobs yet. Create your first job to get started."
              header={header}
            />
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The job and all its versions will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateJobDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultProviderId={providerFromQuery}
        onCreated={(jobId) => router.push(`/transcription/jobs/${jobId}`)}
      />
    </div>
  );
}

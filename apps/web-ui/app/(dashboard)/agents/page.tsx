'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
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
import { Bot, Plus, Search, Trash2, Pencil, Play } from 'lucide-react';
import { CreateAgentDialog } from '@/components/agents/create-agent-dialog';
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

interface Agent {
  id: string;
  name: string;
  description: string | null;
  type: 'simple' | 'graph';
  status: 'draft' | 'active' | 'inactive';
  updatedAt: string;
}

const STATUS_VARIANT: Record<Agent['status'], 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  draft: 'secondary',
  inactive: 'outline',
};

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const fetchAgents = () => {
    setLoading(true);
    fetch('/api/agents?pageSize=50')
      .then((res) => res.json())
      .then((data) => {
        setAgents(data.items ?? []);
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load agents');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  const filteredData = useMemo(() => {
    if (!search) return agents;
    const term = search.toLowerCase();
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(term) ||
        (a.description ?? '').toLowerCase().includes(term)
    );
  }, [agents, search]);

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/agents/${id}`, { method: 'DELETE' });
      setAgents((prev) => prev.filter((a) => a.id !== id));
      toast.success('Agent deleted');
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete agent');
    }
  };

  const columns: ColumnDef<Agent>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => {
          const agent = row.original;
          return (
            <button
              className="flex items-center gap-2 font-medium hover:underline text-left"
              onClick={() => router.push(`/agents/${agent.id}`)}
            >
              <Bot className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>{agent.name}</span>
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
        accessorKey: 'type',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
          <Badge variant="outline" className="capitalize">
            {row.original.type}
          </Badge>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status]} className="capitalize">
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
              onClick={() => router.push(`/agents/${row.original.id}/playground`)}
              aria-label="Open playground"
            >
              <Play className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => router.push(`/agents/${row.original.id}/edit`)}
              aria-label="Edit agent"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => setDeleteTarget(row.original.id)}
              aria-label="Delete agent"
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
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 w-full"
        />
      </div>
      <Button onClick={() => setDialogOpen(true)}>
        <Plus className="h-4 w-4 mr-2" />
        New Agent
      </Button>
    </div>
  );

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center gap-2">
        <Bot className="h-6 w-6" />
        <h2 className="text-3xl font-bold tracking-tight">Agent Studio</h2>
      </div>
      <p className="text-muted-foreground">Build and manage AI agents for your workspace.</p>

      <Card>
        <CardHeader>
          <CardTitle>Agents</CardTitle>
          <CardDescription>
            {loading ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              `${filteredData.length} agent${filteredData.length !== 1 ? 's' : ''}`
            )}
          </CardDescription>
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
              data={filteredData}
              loading={false}
              enablePagination
              enableSorting
              enableFiltering={false}
              defaultPageSize={25}
              emptyMessage="No agents yet. Create your first agent to get started."
              header={header}
            />
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The agent and all its versions will be permanently deleted.
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

      <CreateAgentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => {
          setDialogOpen(false);
          fetchAgents();
        }}
      />
    </div>
  );
}

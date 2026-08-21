'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Server, Plus, Pencil, Trash2, MoreHorizontal, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { PageHeaderTitle } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import { useMcpServers, useDeleteMcpServer, useTestMcpServer, type McpServer } from '@/hooks/use-mcp-servers';
import { McpServerFormDialog } from './mcp-server-form-dialog';

function transportLabel(t: McpServer['transport']) {
  if (t === 'sse') return 'SSE';
  if (t === 'stdio') return 'stdio';
  return 'HTTP Bridge';
}

function statusVariant(s: McpServer['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (s === 'active') return 'default';
  if (s === 'error') return 'destructive';
  return 'secondary';
}

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function TestConnectionItem({ server }: { server: McpServer }) {
  const test = useTestMcpServer(server.id);
  const onTest = async () => {
    try {
      const result = await test.mutateAsync();
      if (result.connected) toast.success('Connected', { description: `${result.toolCount ?? 0} tool(s) discovered` });
      else toast.error('Connection failed', { description: result.error || 'Unknown error' });
    } catch (e) {
      toast.error('Test failed', { description: e instanceof Error ? e.message : 'Try again' });
    }
  };
  return (
    <DropdownMenuItem onClick={onTest} disabled={test.isPending}>
      {test.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Test connection
    </DropdownMenuItem>
  );
}

export function McpServersClient() {
  const { data, isLoading } = useMcpServers({ pageSize: 100 });
  const deleteServer = useDeleteMcpServer();
  // Replaces window.confirm, which styles the destructive choice exactly like
  // Cancel and defaults to acting.
  const [pendingDelete, setPendingDelete] = useState<McpServer | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (s: McpServer) => { setEditing(s); setDialogOpen(true); };
  const onDelete = async () => {
    const s = pendingDelete;
    if (!s) return;
    try {
      await deleteServer.mutateAsync(s.id);
      toast.success('MCP server deleted', { description: s.name });
    } catch (e) {
      toast.error('Delete failed', { description: e instanceof Error ? e.message : 'Try again' });
    }
  };

  const rows = data?.items ?? [];

  const columns = useMemo<ColumnDef<McpServer>[]>(() => [
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      cell: ({ row }) => {
        const s = row.original;
        return (
          <button type="button" onClick={() => openEdit(s)} className="text-left min-w-0 max-w-[380px] block">
            <div className="font-medium truncate hover:underline">{s.name}</div>
            {s.description && <div className="text-xs text-muted-foreground truncate">{s.description}</div>}
          </button>
        );
      },
    },
    {
      accessorKey: 'transport',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Transport" />,
      cell: ({ row }) => <Badge variant="outline">{transportLabel(row.original.transport)}</Badge>,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <Badge variant={statusVariant(row.original.status)}>{row.original.status}</Badge>,
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
      cell: ({ row }) => <span className="text-sm text-muted-foreground whitespace-nowrap">{formatDate(row.original.createdAt)}</span>,
      sortingFn: 'datetime',
    },
    {
      id: 'actions',
      header: () => <div className="text-right">Actions</div>,
      enableSorting: false,
      cell: ({ row }) => {
        const s = row.original;
        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" className="h-8 w-8 p-0" aria-label="Open actions menu">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(s)}><Pencil className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
                <TestConnectionItem server={s} />
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setPendingDelete(s)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeaderTitle
          icon={Server}
          title="MCP Configuration"
          description="Registered Model Context Protocol servers — every active server is available to Claw automatically."
        />
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Create server</Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        enableFiltering={false}
        defaultPageSize={10}
        emptyMessage="No MCP servers yet. Create your first one."
      />

      <McpServerFormDialog open={dialogOpen} onOpenChange={setDialogOpen} server={editing} />
    <ConfirmDialog
      open={pendingDelete !== null}
      onOpenChange={(open) => !open && setPendingDelete(null)}
      title={`Delete MCP server "${pendingDelete?.name ?? ''}"?`}
      description="Its tools stop being available to Claw immediately. This cannot be undone."
      confirmLabel="Delete server"
      onConfirm={onDelete}
    />
    </div>
  );
}

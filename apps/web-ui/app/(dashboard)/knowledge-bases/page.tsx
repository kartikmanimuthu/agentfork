'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import { toast } from 'sonner';
import { Database, Plus, Search, Trash2, Settings, FileText } from 'lucide-react';

interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  status: string;
  documentCount: number;
  chunkCount: number;
  embeddingProvider: string;
  chunkStrategy: string;
  createdAt: string;
  updatedAt: string;
}

export default function KnowledgeBasesPage() {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/knowledge-bases?limit=50')
      .then((res) => res.json())
      .then((data) => {
        setKbs(data.items ?? []);
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load knowledge bases');
        setLoading(false);
      });
  }, []);

  const filteredData = useMemo(() => {
    if (!search) return kbs;
    const term = search.toLowerCase();
    return kbs.filter(
      (kb) =>
        kb.name.toLowerCase().includes(term) ||
        (kb.description ?? '').toLowerCase().includes(term)
    );
  }, [kbs, search]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this knowledge base and all its data?')) return;
    try {
      const res = await fetch(`/api/knowledge-bases/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setKbs((prev) => prev.filter((kb) => kb.id !== id));
      toast.success('Knowledge base deleted');
    } catch {
      toast.error('Failed to delete knowledge base');
    }
  };

  const columns: ColumnDef<KnowledgeBase>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => {
          const kb = row.original;
          return (
            <Link
              href={`/knowledge-bases/${kb.id}`}
              className="flex items-center gap-2 font-medium hover:underline"
            >
              <Database className="h-4 w-4 text-muted-foreground" />
              <div>
                <div>{kb.name}</div>
                {kb.description && (
                  <div className="text-xs text-muted-foreground truncate max-w-xs">
                    {kb.description}
                  </div>
                )}
              </div>
            </Link>
          );
        },
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Badge variant={row.original.status === 'active' ? 'default' : 'secondary'}>
            {row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: 'documentCount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Documents" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.documentCount}</span>
        ),
      },
      {
        accessorKey: 'chunkCount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Chunks" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.chunkCount.toLocaleString()}</span>
        ),
      },
      {
        accessorKey: 'embeddingProvider',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Embedding" />,
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs">
            {row.original.embeddingProvider}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Link
              href={`/knowledge-bases/${row.original.id}/documents`}
              aria-label="Documents"
              className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'h-8 w-8' })}
            >
              <FileText className="h-4 w-4" />
            </Link>
            <Link
              href={`/knowledge-bases/${row.original.id}/settings`}
              aria-label="Settings"
              className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'h-8 w-8' })}
            >
              <Settings className="h-4 w-4" />
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => handleDelete(row.original.id)}
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  const header = (
    <div className="flex items-center justify-between gap-4">
      <div className="relative w-full max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search knowledge bases..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <Link href="/knowledge-bases/new" className={buttonVariants()}>
        <Plus className="h-4 w-4 mr-2" />
        New Knowledge Base
      </Link>
    </div>
  );

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center gap-2">
        <Database className="h-6 w-6" />
        <h2 className="text-3xl font-bold tracking-tight">Knowledge Bases</h2>
      </div>
      <p className="text-muted-foreground">
        Manage your document collections for AI-powered retrieval.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>All Knowledge Bases</CardTitle>
          <CardDescription>
            {loading ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              `${filteredData.length} knowledge base${filteredData.length !== 1 ? 's' : ''}`
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
              data={filteredData}
              loading={false}
              enablePagination
              enableSorting
              enableFiltering={false}
              defaultPageSize={25}
              emptyMessage="No knowledge bases yet. Create one to get started."
              header={header}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

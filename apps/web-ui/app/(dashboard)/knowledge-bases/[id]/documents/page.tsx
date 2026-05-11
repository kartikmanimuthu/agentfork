'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import { toast } from 'sonner';
import { FileText, ArrowLeft, Upload, Trash2, RefreshCw, Globe } from 'lucide-react';
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

interface Document {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  tokenCount: number | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  READY: 'default',
  PENDING: 'secondary',
  PROCESSING: 'secondary',
  CHUNKING: 'secondary',
  EMBEDDING: 'secondary',
  FAILED: 'destructive',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgeBaseDocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const [sources, setSources] = useState<Array<{ id: string; type: string }>>([]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const loadSources = useCallback(() => {
    fetch(`/api/knowledge-bases/${id}/sources`)
      .then((res) => res.json())
      .then((data) => {
        const items = data.items ?? [];
        setSources(items);
        if (items.length > 0 && !selectedSource) {
          setSelectedSource(items[0].id);
        }
      })
      .catch(() => toast.error('Failed to load sources'));
  }, [id, selectedSource]);

  const loadDocuments = useCallback(() => {
    if (!selectedSource) return;
    setLoading(true);
    fetch(`/api/knowledge-bases/${id}/documents?sourceId=${selectedSource}&limit=50`)
      .then((res) => res.json())
      .then((data) => {
        setDocuments(data.items ?? []);
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load documents');
        setLoading(false);
      });
  }, [id, selectedSource]);

  useEffect(() => { loadSources(); }, [id]);
  useEffect(() => { loadDocuments(); }, [selectedSource]);

  const handleDelete = async (docId: string) => {
    try {
      const res = await fetch(`/api/knowledge-bases/${id}/documents/${docId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      toast.success('Document deleted');
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete document');
    }
  };

  const columns: ColumnDef<Document>[] = [
    {
      accessorKey: 'fileName',
      header: ({ column }) => <DataTableColumnHeader column={column} title="File" />,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium truncate max-w-xs">{row.original.fileName}</span>
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => (
        <Badge variant={STATUS_COLORS[row.original.status] ?? 'outline'}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: 'sizeBytes',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Size" />,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{formatBytes(row.original.sizeBytes)}</span>
      ),
    },
    {
      accessorKey: 'tokenCount',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tokens" />,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.tokenCount?.toLocaleString() ?? '—'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="text-right">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive"
            onClick={() => setDeleteTarget(row.original.id)}
            aria-label="Delete document"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href={`/knowledge-bases/${id}`} aria-label="Back" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <FileText className="h-5 w-5" />
          <h2 className="text-2xl font-bold tracking-tight">Documents</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={loadDocuments} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Link href={`/knowledge-bases/${id}/upload`} className={buttonVariants()}>
            <Upload className="h-4 w-4 mr-2" />
            Upload
          </Link>
        </div>
      </div>

      {sources.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {sources.map((s) => (
            <Button
              key={s.id}
              variant={selectedSource === s.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedSource(s.id)}
            >
              {s.type} source {s.type === 'URL' && <Globe className="h-3 w-3 inline" />}
            </Button>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Uploaded Documents</CardTitle>
          <CardDescription>
            {loading ? <Skeleton className="h-4 w-24" /> : `${documents.length} document${documents.length !== 1 ? 's' : ''}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={documents}
              loading={false}
              enablePagination
              enableSorting
              enableFiltering={false}
              defaultPageSize={25}
              emptyMessage="No documents yet. Upload files to get started."
            />
          )}
        </CardContent>
      </Card>
    <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete document?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the document. This action cannot be undone.
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
    </div>
  );
}

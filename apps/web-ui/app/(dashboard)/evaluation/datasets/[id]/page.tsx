'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronLeft, Plus, Upload, Trash2, Eye, Pencil, Download } from 'lucide-react';

const EXPORT_FORMATS: { value: string; label: string; hint: string }[] = [
  { value: 'jsonl', label: 'JSONL (raw)', hint: 'One item per line — re-importable' },
  { value: 'openai', label: 'OpenAI chat', hint: 'messages[] fine-tuning format' },
  { value: 'anthropic', label: 'Anthropic / Bedrock', hint: 'system + messages[]' },
  { value: 'prompt-completion', label: 'Prompt / completion', hint: 'Generic SFT pairs' },
  { value: 'csv', label: 'CSV', hint: 'Spreadsheets / pandas' },
  { value: 'json', label: 'JSON', hint: 'Pretty array' },
];

interface DatasetItem {
  id: string;
  input: unknown;
  expectedOutput: unknown;
  status: string;
  createdAt: string;
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stringifyForEdit(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export default function DatasetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: dsData } = useQuery<{ dataset: { name: string; description: string | null } }>({
    queryKey: ['eval-dataset', id],
    queryFn: async () => (await fetch(`/api/evaluation/datasets/${id}`)).json(),
  });
  const { data, isLoading } = useQuery<{ items: DatasetItem[] }>({
    queryKey: ['eval-dataset-items', id],
    queryFn: async () => (await fetch(`/api/evaluation/datasets/${id}/items`)).json(),
  });

  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DatasetItem | null>(null);
  const [inputText, setInputText] = useState('');
  const [expectedText, setExpectedText] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['eval-dataset-items', id] });

  useEffect(() => {
    if (!itemDialogOpen) return;
    setErr(null);
    setInputText(editTarget ? stringifyForEdit(editTarget.input) : '');
    setExpectedText(editTarget ? stringifyForEdit(editTarget.expectedOutput) : '');
  }, [itemDialogOpen, editTarget]);

  const saveItem = useMutation({
    mutationFn: async () => {
      const body = {
        input: parseMaybeJson(inputText),
        expectedOutput: expectedText ? parseMaybeJson(expectedText) : undefined,
      };
      const url = editTarget
        ? `/api/evaluation/datasets/${id}/items/${editTarget.id}`
        : `/api/evaluation/datasets/${id}/items`;
      const res = await fetch(url, {
        method: editTarget ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
    },
    onSuccess: () => {
      toast.success(editTarget ? 'Item updated' : 'Item added');
      setItemDialogOpen(false);
      invalidate();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const importItems = useMutation({
    mutationFn: async () => {
      const rows = JSON.parse(importText);
      if (!Array.isArray(rows)) throw new Error('Import must be a JSON array');
      const res = await fetch(`/api/evaluation/datasets/${id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: rows }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
    },
    onSuccess: () => {
      toast.success('Items imported');
      setImportOpen(false);
      setImportText('');
      setErr(null);
      invalidate();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const del = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/evaluation/datasets/${id}/items/${itemId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete item');
    },
    onSuccess: () => {
      toast.success('Item deleted');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openAdd = () => {
    setEditTarget(null);
    setItemDialogOpen(true);
  };

  const itemCount = data?.items?.length ?? 0;

  const downloadExport = (format: string) => {
    try {
      const a = document.createElement('a');
      a.href = `/api/evaluation/datasets/${id}/export?format=${encodeURIComponent(format)}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success('Export started');
    } catch {
      toast.error('Failed to export dataset');
    }
  };

  const columns: ColumnDef<DatasetItem>[] = useMemo(
    () => [
      {
        id: 'input',
        header: () => <span>Input</span>,
        cell: ({ row }) => (
          <span className="block max-w-md truncate font-mono text-xs">{JSON.stringify(row.original.input)}</span>
        ),
      },
      {
        id: 'expectedOutput',
        header: () => <span>Expected output</span>,
        cell: ({ row }) => (
          <span className="block max-w-md truncate font-mono text-xs text-muted-foreground">
            {row.original.expectedOutput != null ? JSON.stringify(row.original.expectedOutput) : '—'}
          </span>
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
              onClick={() => router.push(`/evaluation/datasets/${id}/items/${row.original.id}`)}
              aria-label="View item"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setEditTarget(row.original);
                setItemDialogOpen(true);
              }}
              aria-label="Edit item"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => setDeleteTarget(row.original.id)}
              aria-label="Delete item"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id]
  );

  const header = (
    <div className="flex items-center justify-end gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" disabled={itemCount === 0}>
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Export {itemCount} item{itemCount !== 1 ? 's' : ''} as…</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {EXPORT_FORMATS.map((f) => (
            <DropdownMenuItem key={f.value} onClick={() => downloadExport(f.value)} className="flex-col items-start gap-0.5">
              <span className="font-medium">{f.label}</span>
              <span className="text-xs text-muted-foreground">{f.hint}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" onClick={() => setImportOpen(true)}>
        <Upload className="h-4 w-4 mr-1" /> Import
      </Button>
      <Button onClick={openAdd}>
        <Plus className="h-4 w-4 mr-1" /> Add item
      </Button>
    </div>
  );

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <Button variant="ghost" size="sm" className="w-fit" onClick={() => router.push('/evaluation/datasets')}>
        <ChevronLeft className="size-4 mr-1" /> Datasets
      </Button>
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{dsData?.dataset?.name}</h2>
        <p className="text-muted-foreground">{dsData?.dataset?.description}</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={data?.items ?? []}
            loading={isLoading}
            enableFiltering={false}
            defaultPageSize={25}
            emptyMessage="No items yet. Add an item or import a JSON array."
            header={header}
          />
        </CardContent>
      </Card>

      {/* Add / Edit item */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit item' : 'Add item'}</DialogTitle>
            <DialogDescription>Provide an input and an optional expected output (text or JSON).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="item-input">Input (text or JSON)</Label>
              <Textarea
                id="item-input"
                rows={5}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-expected">Expected output (optional)</Label>
              <Textarea
                id="item-expected"
                rows={5}
                value={expectedText}
                onChange={(e) => setExpectedText(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveItem.mutate()} disabled={saveItem.isPending || !inputText}>
              {editTarget ? 'Save changes' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import items (JSON array)</DialogTitle>
            <DialogDescription>Each row must be an object with an <code>input</code> and optional <code>expectedOutput</code>.</DialogDescription>
          </DialogHeader>
          <Textarea
            rows={10}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            className="font-mono text-xs"
            placeholder='[{"input": {"q": "hi"}, "expectedOutput": {"a": "hello"}}]'
          />
          {err && <p className="text-sm text-destructive">{err}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => importItems.mutate()} disabled={importItems.isPending || !importText}>
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete item?</AlertDialogTitle>
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
    </div>
  );
}

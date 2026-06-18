'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { ChevronLeft, Plus, Upload, Trash2 } from 'lucide-react';

interface DatasetItem { id: string; input: unknown; expectedOutput: unknown; status: string; createdAt: string; }

function parseMaybeJson(text: string): unknown { try { return JSON.parse(text); } catch { return text; } }

export default function DatasetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: dsData } = useQuery<{ dataset: { name: string; description: string | null } }>({ queryKey: ['eval-dataset', id], queryFn: async () => (await fetch(`/api/evaluation/datasets/${id}`)).json() });
  const { data, isLoading } = useQuery<{ items: DatasetItem[] }>({ queryKey: ['eval-dataset-items', id], queryFn: async () => (await fetch(`/api/evaluation/datasets/${id}/items`)).json() });

  const [addOpen, setAddOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [expectedText, setExpectedText] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['eval-dataset-items', id] });

  const addItem = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/evaluation/datasets/${id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: parseMaybeJson(inputText), expectedOutput: expectedText ? parseMaybeJson(expectedText) : undefined }) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
    },
    onSuccess: () => { setAddOpen(false); setInputText(''); setExpectedText(''); setErr(null); invalidate(); },
    onError: (e: Error) => setErr(e.message),
  });

  const importItems = useMutation({
    mutationFn: async () => {
      // Accepts a JSON array of { input, expectedOutput? } objects.
      const rows = JSON.parse(importText);
      if (!Array.isArray(rows)) throw new Error('Import must be a JSON array');
      const res = await fetch(`/api/evaluation/datasets/${id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: rows }) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
    },
    onSuccess: () => { setImportOpen(false); setImportText(''); setErr(null); invalidate(); },
    onError: (e: Error) => setErr(e.message),
  });

  const del = useMutation({
    mutationFn: async (itemId: string) => fetch(`/api/evaluation/datasets/${id}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  return (
    <div className="p-6 space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/evaluation/datasets')}><ChevronLeft className="size-4 mr-1" /> Datasets</Button>
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold">{dsData?.dataset?.name}</h1><p className="text-sm text-muted-foreground">{dsData?.dataset?.description}</p></div>
        <div className="flex gap-2">
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger render={<Button variant="outline"><Upload className="size-4 mr-1" /> Import</Button>} />
            <DialogContent>
              <DialogHeader><DialogTitle>Import items (JSON array)</DialogTitle></DialogHeader>
              <Textarea rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='[{"input": {"q": "hi"}, "expectedOutput": {"a": "hello"}}]' />
              {err && <p className="text-sm text-destructive">{err}</p>}
              <DialogFooter><Button onClick={() => importItems.mutate()} disabled={importItems.isPending}>Import</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger render={<Button><Plus className="size-4 mr-1" /> Add item</Button>} />
            <DialogContent>
              <DialogHeader><DialogTitle>Add item</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Input (text or JSON)</Label><Textarea rows={4} value={inputText} onChange={(e) => setInputText(e.target.value)} /></div>
                <div><Label>Expected output (optional)</Label><Textarea rows={4} value={expectedText} onChange={(e) => setExpectedText(e.target.value)} /></div>
                {err && <p className="text-sm text-destructive">{err}</p>}
              </div>
              <DialogFooter><Button onClick={() => addItem.mutate()} disabled={addItem.isPending || !inputText}>Add</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <Table>
          <TableHeader><TableRow><TableHead>Input</TableHead><TableHead>Expected output</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {(data?.items ?? []).map((it) => (
              <TableRow key={it.id}>
                <TableCell className="max-w-md truncate font-mono text-xs">{JSON.stringify(it.input)}</TableCell>
                <TableCell className="max-w-md truncate font-mono text-xs">{JSON.stringify(it.expectedOutput)}</TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => del.mutate(it.id)}><Trash2 className="size-4" /></Button></TableCell>
              </TableRow>
            ))}
            {(data?.items ?? []).length === 0 && <TableRow><TableCell colSpan={3} className="text-sm text-muted-foreground">No items yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

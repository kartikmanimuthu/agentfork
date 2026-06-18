'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Plus, Trash2 } from 'lucide-react';
import { scoreConfigCreateSchema } from '@chatbot/shared';

interface ScoreConfig { id: string; name: string; dataType: string; minValue: number | null; maxValue: number | null; categories: { label: string; value: number }[] | null; isArchived: boolean; }
interface ScoreRow { id: string; targetType: string; numericValue: number | null; stringValue: string | null; source: string; comment: string | null; createdAt: string; config: { name: string; dataType: string }; messageId: string | null; sessionId: string | null; }

export default function ScoresPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Evaluation Scores</h1>
        <p className="text-sm text-muted-foreground">Grade real conversations and manage your score definitions.</p>
      </div>
      <Tabs defaultValue="scores">
        <TabsList>
          <TabsTrigger value="scores">Scores</TabsTrigger>
          <TabsTrigger value="configs">Score Configs</TabsTrigger>
        </TabsList>
        <TabsContent value="scores"><ScoresTab /></TabsContent>
        <TabsContent value="configs"><ConfigsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function ScoresTab() {
  const { data, isLoading } = useQuery<{ scores: ScoreRow[] }>({
    queryKey: ['eval-scores'],
    queryFn: async () => (await fetch('/api/evaluation/scores')).json(),
  });
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: async (id: string) => fetch(`/api/evaluation/scores/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['eval-scores'] }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground py-8">Loading…</p>;
  const scores = data?.scores ?? [];
  if (scores.length === 0) return <p className="text-sm text-muted-foreground py-8">No scores yet. Score a conversation from its detail page.</p>;

  return (
    <Table>
      <TableHeader>
        <TableRow><TableHead>Config</TableHead><TableHead>Value</TableHead><TableHead>Target</TableHead><TableHead>Source</TableHead><TableHead>Comment</TableHead><TableHead></TableHead></TableRow>
      </TableHeader>
      <TableBody>
        {scores.map((s) => (
          <TableRow key={s.id}>
            <TableCell className="font-medium">{s.config?.name}</TableCell>
            <TableCell>{s.stringValue ?? s.numericValue}</TableCell>
            <TableCell><Badge variant="outline">{s.targetType}</Badge></TableCell>
            <TableCell><Badge variant={s.source === 'API' ? 'secondary' : 'default'}>{s.source}</Badge></TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">{s.comment}</TableCell>
            <TableCell><Button variant="ghost" size="icon" onClick={() => del.mutate(s.id)}><Trash2 className="size-4" /></Button></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ConfigsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ configs: ScoreConfig[] }>({
    queryKey: ['eval-score-configs'],
    queryFn: async () => (await fetch('/api/evaluation/score-configs')).json(),
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dataType, setDataType] = useState<'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN'>('NUMERIC');
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [categoriesText, setCategoriesText] = useState('good=1\nbad=0');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { name, description: description || undefined, dataType };
      if (dataType === 'NUMERIC') { if (minValue) payload.minValue = Number(minValue); if (maxValue) payload.maxValue = Number(maxValue); }
      if (dataType === 'CATEGORICAL') {
        payload.categories = categoriesText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
          const [label, value] = l.split('='); return { label: label.trim(), value: Number(value) };
        });
      }
      const parsed = scoreConfigCreateSchema.safeParse(payload);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const res = await fetch('/api/evaluation/score-configs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
    },
    onSuccess: () => { setOpen(false); setName(''); setError(null); qc.invalidateQueries({ queryKey: ['eval-score-configs'] }); },
    onError: (e: Error) => setError(e.message),
  });
  const archive = useMutation({
    mutationFn: async (id: string) => fetch(`/api/evaluation/score-configs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['eval-score-configs'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button><Plus className="size-4 mr-1" /> New config</Button>} />
          <DialogContent>
            <DialogHeader><DialogTitle>New score config</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="helpfulness" /></div>
              <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              <div>
                <Label>Data type</Label>
                <Select value={dataType} onValueChange={(v) => setDataType(v as typeof dataType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NUMERIC">Numeric</SelectItem>
                    <SelectItem value="CATEGORICAL">Categorical</SelectItem>
                    <SelectItem value="BOOLEAN">Boolean</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {dataType === 'NUMERIC' && (
                <div className="flex gap-2">
                  <div><Label>Min</Label><Input type="number" value={minValue} onChange={(e) => setMinValue(e.target.value)} /></div>
                  <div><Label>Max</Label><Input type="number" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} /></div>
                </div>
              )}
              {dataType === 'CATEGORICAL' && (
                <div><Label>Categories (one `label=value` per line)</Label><Textarea value={categoriesText} onChange={(e) => setCategoriesText(e.target.value)} rows={4} /></div>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending || !name}>Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground py-8">Loading…</p> : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Range / Categories</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {(data?.configs ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell><Badge variant="outline">{c.dataType}</Badge></TableCell>
                <TableCell className="text-muted-foreground">
                  {c.dataType === 'NUMERIC' ? `${c.minValue ?? '−∞'} … ${c.maxValue ?? '∞'}` : c.dataType === 'CATEGORICAL' ? (c.categories ?? []).map((x) => x.label).join(', ') : 'true / false'}
                </TableCell>
                <TableCell><Button variant="ghost" size="sm" onClick={() => archive.mutate(c.id)}>Archive</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ClipboardCheck } from 'lucide-react';

interface ScoreConfig { id: string; name: string; dataType: string; categories: { label: string; value: number }[] | null; }
interface Dataset { id: string; name: string; }

export function ScoreDrawer({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const { data: cfgData } = useQuery<{ configs: ScoreConfig[] }>({ queryKey: ['eval-score-configs'], queryFn: async () => (await fetch('/api/evaluation/score-configs')).json() });
  const { data: dsData } = useQuery<{ datasets: Dataset[] }>({ queryKey: ['eval-datasets'], queryFn: async () => (await fetch('/api/evaluation/datasets')).json() });
  const { data: existing } = useQuery<{ scores: { id: string; config: { name: string }; numericValue: number | null; stringValue: string | null }[] }>({
    queryKey: ['eval-scores', 'SESSION', sessionId],
    queryFn: async () => (await fetch(`/api/evaluation/scores?targetType=SESSION&sessionId=${encodeURIComponent(sessionId)}`)).json(),
  });

  const [configId, setConfigId] = useState('');
  const [value, setValue] = useState('');
  const [comment, setComment] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const configs = cfgData?.configs ?? [];
  const selected = configs.find((c) => c.id === configId);

  const submit = useMutation({
    mutationFn: async () => {
      let parsedValue: number | string | boolean = value;
      if (selected?.dataType === 'NUMERIC') parsedValue = Number(value);
      if (selected?.dataType === 'BOOLEAN') parsedValue = value === 'true';
      const res = await fetch('/api/evaluation/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configId, targetType: 'SESSION', targetId: sessionId, value: parsedValue, comment: comment || undefined }) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
    },
    onSuccess: () => { setMsg('Score saved'); setValue(''); setComment(''); qc.invalidateQueries({ queryKey: ['eval-scores', 'SESSION', sessionId] }); },
    onError: (e: Error) => setMsg(e.message),
  });

  const addToDataset = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/evaluation/datasets/${datasetId}/items/from-trace`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetType: 'SESSION', targetId: sessionId }) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
    },
    onSuccess: () => setMsg('Added to dataset'),
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" size="sm"><ClipboardCheck className="size-4 mr-1" /> Score</Button>} />
      <SheetContent className="w-[400px] sm:max-w-[400px]">
        <SheetHeader><SheetTitle>Evaluate session</SheetTitle></SheetHeader>
        <div className="space-y-4 mt-4 px-1">
          <div>
            <Label>Score config</Label>
            <Select value={configId} onValueChange={setConfigId}>
              <SelectTrigger><SelectValue placeholder="Pick a config" /></SelectTrigger>
              <SelectContent>{configs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.dataType})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {selected?.dataType === 'CATEGORICAL' ? (
            <div><Label>Value</Label>
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
                <SelectContent>{(selected.categories ?? []).map((c) => <SelectItem key={c.label} value={c.label}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : selected?.dataType === 'BOOLEAN' ? (
            <div><Label>Value</Label>
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
                <SelectContent><SelectItem value="true">true</SelectItem><SelectItem value="false">false</SelectItem></SelectContent>
              </Select>
            </div>
          ) : (
            <div><Label>Value</Label><Input type="number" value={value} onChange={(e) => setValue(e.target.value)} /></div>
          )}
          <div><Label>Comment</Label><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          <Button onClick={() => submit.mutate()} disabled={!configId || value === '' || submit.isPending} className="w-full">Save score</Button>

          <div className="border-t pt-4">
            <Label>Add this session to a dataset</Label>
            <div className="flex gap-2 mt-1">
              <Select value={datasetId} onValueChange={setDatasetId}>
                <SelectTrigger><SelectValue placeholder="Pick dataset" /></SelectTrigger>
                <SelectContent>{(dsData?.datasets ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" onClick={() => addToDataset.mutate()} disabled={!datasetId || addToDataset.isPending}>Add</Button>
            </div>
          </div>

          {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

          <div className="border-t pt-4">
            <Label>Existing session scores</Label>
            <div className="space-y-1 mt-2">
              {(existing?.scores ?? []).map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <span>{s.config?.name}</span>
                  <Badge variant="outline">{s.stringValue ?? s.numericValue}</Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

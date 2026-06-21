'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ClipboardCheck } from 'lucide-react';

interface ScoreConfig {
  id: string;
  name: string;
  dataType: string;
  categories: { label: string; value: number }[] | null;
}

function buildScoreFilterUrl(targetType: string, targetId: string): string {
  const param = targetType === 'SESSION' ? 'sessionId' : 'executionId';
  return `/api/evaluation/scores?targetType=${targetType}&${param}=${encodeURIComponent(targetId)}`;
}

export function ScoreDrawer({
  targetType,
  targetId,
  label,
}: {
  targetType: 'SESSION' | 'EXECUTION';
  targetId: string;
  label?: string;
}) {
  const qc = useQueryClient();
  const { data: cfgData } = useQuery<{ configs: ScoreConfig[] }>({
    queryKey: ['eval-score-configs'],
    queryFn: async () => (await fetch('/api/evaluation/score-configs')).json(),
  });
  const { data: existing } = useQuery<{
    scores: { id: string; config: { name: string }; numericValue: number | null; stringValue: string | null }[];
  }>({
    queryKey: ['eval-scores', targetType, targetId],
    queryFn: async () => (await fetch(buildScoreFilterUrl(targetType, targetId))).json(),
  });

  const [configId, setConfigId] = useState('');
  const [value, setValue] = useState('');
  const [comment, setComment] = useState('');

  const configs = cfgData?.configs ?? [];
  const selected = configs.find((c) => c.id === configId);

  const submit = useMutation({
    mutationFn: async () => {
      let parsedValue: number | string | boolean = value;
      if (selected?.dataType === 'NUMERIC') parsedValue = Number(value);
      if (selected?.dataType === 'BOOLEAN') parsedValue = value === 'true';
      const res = await fetch('/api/evaluation/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configId, targetType, targetId, value: parsedValue, comment: comment || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
    },
    onSuccess: () => {
      toast.success('Score saved');
      setValue('');
      setComment('');
      qc.invalidateQueries({ queryKey: ['eval-scores', targetType, targetId] });
      qc.invalidateQueries({ queryKey: ['eval-scores'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const existingScores = existing?.scores ?? [];

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm">
            <ClipboardCheck className="size-4 mr-1" /> Score
          </Button>
        }
      />
      <SheetContent className="w-[420px] sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>Score {label ?? targetType.toLowerCase()}</SheetTitle>
          <SheetDescription>Record a manual evaluation against one of your score configs.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 mt-4 px-4">
          {configs.length === 0 ? (
            <Empty className="border rounded-md py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ClipboardCheck />
                </EmptyMedia>
                <EmptyTitle>No score configs</EmptyTitle>
                <EmptyDescription>Create a score config under Evaluation → Scores first.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Score config</Label>
                <Select value={configId} onValueChange={setConfigId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a config" />
                  </SelectTrigger>
                  <SelectContent>
                    {configs.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.dataType})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Value</Label>
                {selected?.dataType === 'CATEGORICAL' ? (
                  <Select value={value} onValueChange={setValue}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick" />
                    </SelectTrigger>
                    <SelectContent>
                      {(selected.categories ?? []).map((c) => (
                        <SelectItem key={c.label} value={c.label}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : selected?.dataType === 'BOOLEAN' ? (
                  <Select value={value} onValueChange={setValue}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">true</SelectItem>
                      <SelectItem value="false">false</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type="number"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    disabled={!selected}
                    placeholder={selected ? '' : 'Pick a config first'}
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Comment</Label>
                <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional" />
              </div>
              <Button
                onClick={() => submit.mutate()}
                disabled={!configId || value === '' || submit.isPending}
                className="w-full"
              >
                Save score
              </Button>
            </>
          )}

          <div className="border-t pt-4">
            <Label>Existing scores</Label>
            {existingScores.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-2">No scores recorded yet.</p>
            ) : (
              <div className="space-y-1.5 mt-2">
                {existingScores.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm">
                    <span>{s.config?.name}</span>
                    <Badge variant="outline">{s.stringValue ?? s.numericValue}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

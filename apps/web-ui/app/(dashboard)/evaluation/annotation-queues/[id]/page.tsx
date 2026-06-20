'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ChevronLeft, SkipForward } from 'lucide-react';

interface ScoreConfig {
  id: string;
  name: string;
  dataType: 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN';
  minValue: number | null;
  maxValue: number | null;
  categories: { label: string; value: number }[] | null;
}

interface QueueItem {
  id: string;
  status: 'PENDING' | 'REVIEWED' | 'SKIPPED';
  targetType: string;
  message: { role: string; content: string } | null;
  session: { id: string } | null;
  execution: { id: string; input: unknown; output: unknown } | null;
}

interface QueueWithItems {
  queue: {
    id: string;
    name: string;
    scoreConfig: ScoreConfig;
  };
  items: QueueItem[];
}

function targetContent(item: QueueItem): string {
  if (item.message) return `Role: ${item.message.role}\n\n${item.message.content}`;
  if (item.execution) return `Input:\n${JSON.stringify(item.execution.input, null, 2)}\n\nOutput:\n${JSON.stringify(item.execution.output, null, 2)}`;
  if (item.session) return `Session ID: ${item.session.id}`;
  return 'No content';
}

export default function AnnotationQueueReviewPage() {
  const router = useRouter();
  const params = useParams();
  const queueId = String(params.id);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<QueueWithItems>({
    queryKey: ['eval-annotation-queue-items', queueId],
    queryFn: async () => {
      const [queueRes, itemsRes] = await Promise.all([
        fetch(`/api/evaluation/annotation-queues/${queueId}`),
        fetch(`/api/evaluation/annotation-queues/${queueId}/items?status=PENDING`),
      ]);
      return { queue: (await queueRes.json()).queue, items: (await itemsRes.json()).items };
    },
  });

  const [index, setIndex] = useState(0);
  const pendingItems = useMemo(() => data?.items?.filter((i) => i.status === 'PENDING') ?? [], [data]);
  const current = pendingItems[index] ?? null;

  const [value, setValue] = useState<string>('');
  const [comment, setComment] = useState('');

  const review = useMutation({
    mutationFn: async (payload: { status: 'REVIEWED' | 'SKIPPED'; value?: number | string | boolean; comment?: string }) => {
      const res = await fetch(`/api/evaluation/annotation-queues/${queueId}/items/${current!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to submit review');
    },
    onSuccess: () => {
      toast.success('Review submitted');
      setValue('');
      setComment('');
      qc.invalidateQueries({ queryKey: ['eval-annotation-queue-items', queueId] });
      if (index >= pendingItems.length - 1) setIndex(Math.max(0, pendingItems.length - 2));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cfg = data?.queue?.scoreConfig;

  const scoreInput = () => {
    if (!cfg) return null;
    if (cfg.dataType === 'BOOLEAN') {
      return (
        <div className="flex items-center gap-2">
          <Switch id="score" checked={value === 'true'} onCheckedChange={(v) => setValue(String(v))} />
          <Label htmlFor="score">{value === 'true' ? 'True' : 'False'}</Label>
        </div>
      );
    }
    if (cfg.dataType === 'CATEGORICAL' && cfg.categories) {
      return (
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger>
            <SelectValue placeholder="Select label" />
          </SelectTrigger>
          <SelectContent>
            {cfg.categories.map((c) => (
              <SelectItem key={c.value} value={String(c.value)}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    return (
      <Input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={cfg.minValue != null && cfg.maxValue != null ? `${cfg.minValue}–${cfg.maxValue}` : 'Score'}
      />
    );
  };

  const submit = (status: 'REVIEWED' | 'SKIPPED') => {
    if (!current) return;
    const payload: { status: 'REVIEWED' | 'SKIPPED'; value?: number | string | boolean; comment?: string } = { status };
    if (status === 'REVIEWED') {
      if (cfg?.dataType === 'NUMERIC') payload.value = Number(value);
      else if (cfg?.dataType === 'BOOLEAN') payload.value = value === 'true';
      else payload.value = value;
      payload.comment = comment;
    }
    review.mutate(payload);
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => router.push('/evaluation/annotation-queues')}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex-1">
          <h2 className="text-3xl font-bold tracking-tight">{data?.queue?.name ?? 'Review queue'}</h2>
          <p className="text-muted-foreground">{pendingItems.length} pending items</p>
        </div>
      </div>

      {isLoading && <p>Loading...</p>}

      {!isLoading && !current && (
        <Card>
          <CardHeader>
            <CardTitle>All caught up</CardTitle>
            <CardDescription>No pending items in this queue. Use Populate to add more.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {current && cfg && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Review item
              <Badge variant="outline">{current.targetType}</Badge>
              <Badge variant="outline">{cfg.dataType}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border bg-muted p-4 whitespace-pre-wrap text-sm">
              {targetContent(current)}
            </div>
            <div className="space-y-2">
              <Label>Score</Label>
              {scoreInput()}
            </div>
            <div className="space-y-2">
              <Label htmlFor="comment">Comment</Label>
              <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment" />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => submit('REVIEWED')} disabled={review.isPending}>Submit review</Button>
              <Button variant="outline" onClick={() => submit('SKIPPED')} disabled={review.isPending}>
                <SkipForward className="h-4 w-4 mr-2" /> Skip
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

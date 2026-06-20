'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { annotationQueueCreateSchema, annotationQueueUpdateSchema } from '@chatbot/shared/client';
import { scoreTargetTypeSchema } from '@chatbot/shared/client';

interface ScoreConfigOption {
  id: string;
  name: string;
  dataType: 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN';
}

export interface AnnotationQueueForDialog {
  id: string;
  name: string;
  description: string | null;
  scoreConfigId: string;
  targetType: string;
  filters?: { sessionIds?: string[]; messageIds?: string[]; executionIds?: string[] } | null;
}

interface AnnotationQueueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  queue?: AnnotationQueueForDialog | null;
}

const targetTypes = scoreTargetTypeSchema.options;

export function AnnotationQueueDialog({ open, onOpenChange, onSaved, queue }: AnnotationQueueDialogProps) {
  const qc = useQueryClient();
  const isEdit = Boolean(queue);

  const { data: configsData } = useQuery<{ configs: ScoreConfigOption[] }>({
    queryKey: ['eval-score-configs'],
    queryFn: async () => (await fetch('/api/evaluation/score-configs')).json(),
    enabled: open,
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scoreConfigId, setScoreConfigId] = useState('');
  const [targetType, setTargetType] = useState<string>('MESSAGE');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(queue?.name ?? '');
    setDescription(queue?.description ?? '');
    setScoreConfigId(queue?.scoreConfigId ?? '');
    setTargetType(queue?.targetType ?? 'MESSAGE');
  }, [open, queue]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        description: description || undefined,
        scoreConfigId,
        targetType,
      };
      const schema = isEdit ? annotationQueueUpdateSchema : annotationQueueCreateSchema;
      const parsed = schema.safeParse(payload);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const url = isEdit ? `/api/evaluation/annotation-queues/${queue!.id}` : '/api/evaluation/annotation-queues';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? 'Failed to save queue');
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Queue updated' : 'Queue created');
      qc.invalidateQueries({ queryKey: ['eval-annotation-queues'] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit annotation queue' : 'New annotation queue'}</DialogTitle>
          <DialogDescription>Route unscored targets to human reviewers.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="q-name">Name</Label>
            <Input id="q-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Helpfulness review" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="q-scoreConfig">Score config</Label>
              <Select value={scoreConfigId} onValueChange={setScoreConfigId}>
                <SelectTrigger id="q-scoreConfig">
                  <SelectValue placeholder="Select a score config" />
                </SelectTrigger>
                <SelectContent>
                  {configsData?.configs?.map((cfg) => (
                    <SelectItem key={cfg.id} value={cfg.id}>
                      {cfg.name} ({cfg.dataType})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-targetType">Target type</Label>
              <Select value={targetType} onValueChange={setTargetType}>
                <SelectTrigger id="q-targetType">
                  <SelectValue placeholder="Target type" />
                </SelectTrigger>
                <SelectContent>
                  {targetTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving...' : isEdit ? 'Save' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

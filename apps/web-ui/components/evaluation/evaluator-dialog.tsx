'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { evaluatorCreateSchema, evaluatorUpdateSchema } from '@chatbot/shared/client';

interface ScoreConfigOption {
  id: string;
  name: string;
  dataType: 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN';
}

export interface EvaluatorForDialog {
  id: string;
  name: string;
  description: string | null;
  scoreConfigId: string;
  prompt: string;
  model: string | null;
  temperature: number | null;
  maxTokens: number | null;
}

interface EvaluatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  evaluator?: EvaluatorForDialog | null;
}

export function EvaluatorDialog({ open, onOpenChange, onSaved, evaluator }: EvaluatorDialogProps) {
  const qc = useQueryClient();
  const isEdit = Boolean(evaluator);

  const { data: configsData } = useQuery<{ configs: ScoreConfigOption[] }>({
    queryKey: ['eval-score-configs'],
    queryFn: async () => (await fetch('/api/evaluation/score-configs')).json(),
    enabled: open,
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scoreConfigId, setScoreConfigId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(evaluator?.name ?? '');
    setDescription(evaluator?.description ?? '');
    setScoreConfigId(evaluator?.scoreConfigId ?? '');
    setPrompt(evaluator?.prompt ?? '');
    setModel(evaluator?.model ?? '');
    setTemperature(evaluator?.temperature != null ? String(evaluator.temperature) : '');
    setMaxTokens(evaluator?.maxTokens != null ? String(evaluator.maxTokens) : '');
  }, [open, evaluator]);

  const buildPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      name,
      description: description || undefined,
      scoreConfigId,
      prompt,
      model: model || undefined,
    };
    if (temperature) payload.temperature = Number(temperature);
    if (maxTokens) payload.maxTokens = Number(maxTokens);
    return payload;
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      const schema = isEdit ? evaluatorUpdateSchema : evaluatorCreateSchema;
      const parsed = schema.safeParse(payload);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const url = isEdit ? `/api/evaluation/evaluators/${evaluator!.id}` : '/api/evaluation/evaluators';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? 'Failed to save evaluator');
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Evaluator updated' : 'Evaluator created');
      qc.invalidateQueries({ queryKey: ['eval-evaluators'] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit evaluator' : 'New evaluator'}</DialogTitle>
          <DialogDescription>
            Configure an LLM-as-judge evaluator that produces Score rows for a score config.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Helpfulness" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scoreConfig">Score config</Label>
              <Select value={scoreConfigId} onValueChange={setScoreConfigId}>
                <SelectTrigger id="scoreConfig">
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="prompt">Prompt</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Rate the following target on a scale of 1-5..."
              rows={6}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="model">Model (optional)</Label>
              <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. anthropic.claude-3-5-sonnet" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="temperature">Temperature</Label>
              <Input id="temperature" type="number" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="0.7" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxTokens">Max tokens</Label>
              <Input id="maxTokens" type="number" min={1} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="4096" />
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

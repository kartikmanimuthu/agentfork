'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { scoreConfigCreateSchema } from '@chatbot/shared/client';

export interface ScoreConfigForDialog {
  id: string;
  name: string;
  description: string | null;
  dataType: 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN';
  minValue: number | null;
  maxValue: number | null;
  categories: { label: string; value: number }[] | null;
}

interface ScoreConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  /** Pass an existing config to edit; omit to create. */
  config?: ScoreConfigForDialog | null;
}

type DataType = 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN';

function categoriesToText(categories: { label: string; value: number }[] | null | undefined): string {
  if (!categories || categories.length === 0) return 'good=1\nbad=0';
  return categories.map((c) => `${c.label}=${c.value}`).join('\n');
}

export function ScoreConfigDialog({ open, onOpenChange, onSaved, config }: ScoreConfigDialogProps) {
  const qc = useQueryClient();
  const isEdit = Boolean(config);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dataType, setDataType] = useState<DataType>('NUMERIC');
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [categoriesText, setCategoriesText] = useState('good=1\nbad=0');
  const [error, setError] = useState<string | null>(null);

  // Reset form whenever the dialog opens (or the target config changes).
  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(config?.name ?? '');
    setDescription(config?.description ?? '');
    setDataType(config?.dataType ?? 'NUMERIC');
    setMinValue(config?.minValue != null ? String(config.minValue) : '');
    setMaxValue(config?.maxValue != null ? String(config.maxValue) : '');
    setCategoriesText(categoriesToText(config?.categories));
  }, [open, config]);

  const buildPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = { name, description: description || undefined, dataType };
    if (dataType === 'NUMERIC') {
      if (minValue) payload.minValue = Number(minValue);
      if (maxValue) payload.maxValue = Number(maxValue);
    }
    if (dataType === 'CATEGORICAL') {
      payload.categories = categoriesText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [label, value] = l.split('=');
          return { label: (label ?? '').trim(), value: Number(value) };
        });
    }
    return payload;
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      const parsed = scoreConfigCreateSchema.safeParse(payload);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const url = isEdit ? `/api/evaluation/score-configs/${config!.id}` : '/api/evaluation/score-configs';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Config updated' : 'Config created');
      qc.invalidateQueries({ queryKey: ['eval-score-configs'] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit score config' : 'New score config'}</DialogTitle>
          <DialogDescription>
            Score configs define how a conversation or execution is graded.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="config-name">Name</Label>
            <Input id="config-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="helpfulness" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="config-description">Description</Label>
            <Input
              id="config-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Data type</Label>
            <Select value={dataType} onValueChange={(v) => setDataType(v as DataType)} disabled={isEdit}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NUMERIC">Numeric</SelectItem>
                <SelectItem value="CATEGORICAL">Categorical</SelectItem>
                <SelectItem value="BOOLEAN">Boolean</SelectItem>
              </SelectContent>
            </Select>
            {isEdit && <p className="text-xs text-muted-foreground">Data type can&apos;t be changed after creation.</p>}
          </div>
          {dataType === 'NUMERIC' && (
            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="config-min">Min</Label>
                <Input id="config-min" type="number" value={minValue} onChange={(e) => setMinValue(e.target.value)} />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="config-max">Max</Label>
                <Input id="config-max" type="number" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} />
              </div>
            </div>
          )}
          {dataType === 'CATEGORICAL' && (
            <div className="space-y-1.5">
              <Label htmlFor="config-cats">Categories</Label>
              <Textarea
                id="config-cats"
                value={categoriesText}
                onChange={(e) => setCategoriesText(e.target.value)}
                rows={4}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">One <code>label=value</code> pair per line.</p>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name}>
            {isEdit ? 'Save changes' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

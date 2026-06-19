'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface DatasetForDialog {
  id: string;
  name: string;
  description: string | null;
}

interface DatasetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  /** Pass an existing dataset to edit; omit to create. */
  dataset?: DatasetForDialog | null;
}

export function DatasetDialog({ open, onOpenChange, onSaved, dataset }: DatasetDialogProps) {
  const qc = useQueryClient();
  const isEdit = Boolean(dataset);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(dataset?.name ?? '');
    setDescription(dataset?.description ?? '');
  }, [open, dataset]);

  const save = useMutation({
    mutationFn: async () => {
      const url = isEdit ? `/api/evaluation/datasets/${dataset!.id}` : '/api/evaluation/datasets';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      return res.json();
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Dataset updated' : 'Dataset created');
      qc.invalidateQueries({ queryKey: ['eval-datasets'] });
      if (isEdit && dataset) qc.invalidateQueries({ queryKey: ['eval-dataset', dataset.id] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit dataset' : 'New dataset'}</DialogTitle>
          <DialogDescription>Curated collections of evaluation items.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dataset-name">Name</Label>
            <Input id="dataset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Regression set" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dataset-description">Description</Label>
            <Textarea
              id="dataset-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional"
            />
          </div>
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

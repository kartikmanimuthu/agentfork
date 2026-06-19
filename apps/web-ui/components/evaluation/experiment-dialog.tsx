'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { experimentCreateSchema } from '@chatbot/shared/client';

interface DatasetOption {
  id: string;
  name: string;
}

interface AgentVersionOption {
  id: string;
  version: number;
  agent: { id: string; name: string };
}

interface ScoreConfigOption {
  id: string;
  name: string;
  dataType: 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN';
}

interface ExperimentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function ExperimentDialog({ open, onOpenChange, onSaved }: ExperimentDialogProps) {
  const qc = useQueryClient();

  const { data: datasets } = useQuery<{ datasets: DatasetOption[] }>({
    queryKey: ['eval-datasets'],
    queryFn: async () => (await fetch('/api/evaluation/datasets')).json(),
    enabled: open,
  });

  const { data: agentVersions } = useQuery<{ versions: AgentVersionOption[] }>({
    queryKey: ['agent-versions'],
    queryFn: async () => (await fetch('/api/agents/versions')).json(),
    enabled: open,
  });

  const { data: configsData } = useQuery<{ configs: ScoreConfigOption[] }>({
    queryKey: ['eval-score-configs'],
    queryFn: async () => (await fetch('/api/evaluation/score-configs')).json(),
    enabled: open,
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [agentVersionIds, setAgentVersionIds] = useState<string[]>([]);
  const [scoreConfigIds, setScoreConfigIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName('');
    setDescription('');
    setDatasetId('');
    setAgentVersionIds([]);
    setScoreConfigIds([]);
  }, [open]);

  const toggle = (id: string, list: string[], setList: (ids: string[]) => void) => {
    if (list.includes(id)) setList(list.filter((x) => x !== id));
    else setList([...list, id]);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        description: description || undefined,
        datasetId,
        agentVersionIds,
        scoreConfigIds,
      };
      const parsed = experimentCreateSchema.safeParse(payload);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const res = await fetch('/api/evaluation/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? 'Failed to create experiment');
      }
    },
    onSuccess: () => {
      toast.success('Experiment created');
      qc.invalidateQueries({ queryKey: ['eval-experiments'] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New experiment</DialogTitle>
          <DialogDescription>Run a dataset against one or more agent versions.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="exp-name">Name</Label>
            <Input id="exp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="v1 vs v2" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="exp-desc">Description</Label>
            <Input id="exp-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="exp-dataset">Dataset</Label>
            <Select value={datasetId} onValueChange={setDatasetId}>
              <SelectTrigger id="exp-dataset">
                <SelectValue placeholder="Select dataset" />
              </SelectTrigger>
              <SelectContent>
                {datasets?.datasets?.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Agent versions</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto rounded-md border p-2">
              {agentVersions?.versions?.map((v) => (
                <div key={v.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`av-${v.id}`}
                    checked={agentVersionIds.includes(v.id)}
                    onCheckedChange={() => toggle(v.id, agentVersionIds, setAgentVersionIds)}
                  />
                  <Label htmlFor={`av-${v.id}`} className="text-sm font-normal">
                    {v.agent.name} v{v.version}
                  </Label>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Score configs</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto rounded-md border p-2">
              {configsData?.configs?.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`sc-${c.id}`}
                    checked={scoreConfigIds.includes(c.id)}
                    onCheckedChange={() => toggle(c.id, scoreConfigIds, setScoreConfigIds)}
                  />
                  <Label htmlFor={`sc-${c.id}`} className="text-sm font-normal">
                    {c.name} ({c.dataType})
                  </Label>
                </div>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

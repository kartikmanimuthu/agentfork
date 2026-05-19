'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ParallelNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  branches: z.string(),
  mergeStrategy: z.enum(['all', 'race', 'any']),
  outputChannel: z.string().min(1, 'Output channel is required'),
});

type ParallelFormValues = z.infer<typeof schema>;

interface ParallelNodeFormProps {
  config: ParallelNodeConfig;
  onChange: (config: ParallelNodeConfig) => void;
}

export function ParallelNodeForm({ config, onChange }: ParallelNodeFormProps) {
  const form = useForm({
    defaultValues: {
      branches: (config.branches ?? []).join(', '),
      mergeStrategy: config.mergeStrategy ?? 'all',
      outputChannel: config.outputChannel ?? 'parallel_result',
    } as ParallelFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'parallel',
        branches: value.branches
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        mergeStrategy: value.mergeStrategy,
        outputChannel: value.outputChannel,
      });
    },
  });

  const handleBlur = () => form.handleSubmit();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      <form.Field name="branches">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Branches</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="node_1, node_2, node_3"
            />
            <p className="text-[10px] text-muted-foreground">Comma-separated target node IDs</p>
          </div>
        )}
      </form.Field>

      <form.Field name="mergeStrategy">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Merge Strategy</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                field.handleChange(v as ParallelFormValues['mergeStrategy']);
                handleBlur();
              }}
            >
              <SelectTrigger aria-label="Merge Strategy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All (wait for all branches)</SelectItem>
                <SelectItem value="race">Race (first to complete)</SelectItem>
                <SelectItem value="any">Any (at least one)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <form.Field name="outputChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Output Channel</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="parallel_result"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>
    </form>
  );
}

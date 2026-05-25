'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NodePicker } from './node-picker';
import type { NodeOption } from './node-picker';
import type { ParallelNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  branches: z.array(z.string()),
  mergeStrategy: z.enum(['all', 'race', 'any']),
  outputChannel: z.string().min(1, 'Output channel is required'),
});

type ParallelFormValues = z.infer<typeof schema>;

interface ParallelNodeFormProps {
  config: ParallelNodeConfig;
  onChange: (config: ParallelNodeConfig) => void;
  allNodes: NodeOption[];
}

export function ParallelNodeForm({ config, onChange, allNodes }: ParallelNodeFormProps) {
  const form = useForm({
    defaultValues: {
      branches: config.branches ?? [],
      mergeStrategy: config.mergeStrategy ?? 'all',
      outputChannel: config.outputChannel ?? 'parallel_result',
    } as ParallelFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'parallel',
        branches: value.branches.filter(Boolean),
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
      <form.Field name="branches" mode="array">
        {(field) => (
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Branches</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const current = form.getFieldValue('branches') as string[];
                  form.setFieldValue('branches', [...current, '']);
                }}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>
            <div className="space-y-2">
              {(field.state.value as string[]).map((_, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <form.Field name={`branches[${i}]`}>
                    {(branchField) => (
                      <NodePicker
                        nodes={allNodes}
                        value={branchField.state.value as string}
                        onChange={(id) => { branchField.handleChange(id); handleBlur(); }}
                        placeholder="Select branch node…"
                        className="flex-1 h-8 text-xs"
                      />
                    )}
                  </form.Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive shrink-0"
                    onClick={() => {
                      const current = form.getFieldValue('branches') as string[];
                      form.setFieldValue('branches', current.filter((_: string, j: number) => j !== i));
                      handleBlur();
                    }}
                    aria-label={`Remove branch ${i + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {(field.state.value as string[]).length === 0 && (
                <p className="text-xs text-muted-foreground italic">No branches yet.</p>
              )}
            </div>
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

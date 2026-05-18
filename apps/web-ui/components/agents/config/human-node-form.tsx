'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { HumanNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  outputChannel: z.string().min(1, 'Output channel is required'),
  timeoutMs: z.number().int().positive().optional(),
});

type HumanFormValues = z.infer<typeof schema>;

interface HumanNodeFormProps {
  config: HumanNodeConfig;
  onChange: (config: HumanNodeConfig) => void;
}

export function HumanNodeForm({ config, onChange }: HumanNodeFormProps) {
  const form = useForm({
    defaultValues: {
      prompt: config.prompt ?? '',
      outputChannel: config.outputChannel ?? 'human_response',
      timeoutMs: config.timeoutMs,
    } as HumanFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'human',
        prompt: value.prompt,
        outputChannel: value.outputChannel,
        timeoutMs: value.timeoutMs,
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
      <form.Field name="prompt">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Prompt</Label>
            <Textarea
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="Please review the generated response..."
              className="min-h-[80px]"
              rows={4}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
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
              placeholder="human_response"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="timeoutMs">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Timeout (ms)</Label>
            <Input
              id={field.name}
              type="number"
              min={1}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="30000"
            />
            <p className="text-[10px] text-muted-foreground">Optional max wait time for human response</p>
          </div>
        )}
      </form.Field>
    </form>
  );
}

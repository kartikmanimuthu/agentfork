'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { DelayNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  delayMs: z.number().int().positive('Delay must be a positive number'),
  delayChannel: z.string().optional(),
});

type DelayFormValues = z.infer<typeof schema>;

interface DelayNodeFormProps {
  config: DelayNodeConfig;
  onChange: (config: DelayNodeConfig) => void;
}

export function DelayNodeForm({ config, onChange }: DelayNodeFormProps) {
  const form = useForm({
    defaultValues: {
      delayMs: config.delayMs ?? 1000,
      delayChannel: config.delayChannel ?? '',
    } as DelayFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'delay',
        delayMs: value.delayMs,
        delayChannel: value.delayChannel || undefined,
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
      <form.Field name="delayMs">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Delay (ms)</Label>
            <Input
              id={field.name}
              type="number"
              min={1}
              value={field.state.value}
              onChange={(e) => field.handleChange(Number(e.target.value))}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="1000"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="delayChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Delay Channel</Label>
            <Input
              id={field.name}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="Optional channel with delay value"
            />
            <p className="text-[10px] text-muted-foreground">If set, reads delay from this state channel (must be a number)</p>
          </div>
        )}
      </form.Field>
    </form>
  );
}

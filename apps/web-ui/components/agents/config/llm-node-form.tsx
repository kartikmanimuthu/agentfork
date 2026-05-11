'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { ProviderModelSelect } from '@/components/llm-providers/provider-model-select';
import type { LlmNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  model: z.string().min(1, 'Model is required'),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

type LlmFormValues = z.infer<typeof schema>;

interface LlmNodeFormProps {
  config: LlmNodeConfig;
  onChange: (config: LlmNodeConfig) => void;
}

export function LlmNodeForm({ config, onChange }: LlmNodeFormProps) {
  const form = useForm({
    defaultValues: {
      model: config.model ?? '',
      systemPrompt: config.systemPrompt ?? '',
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens,
    } as LlmFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'llm',
        model: value.model,
        systemPrompt: value.systemPrompt || undefined,
        temperature: value.temperature,
        maxTokens: value.maxTokens || undefined,
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
      <form.Field name="model">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Model</Label>
            <ProviderModelSelect
              capability="chat"
              value={field.state.value ?? ''}
              onChange={(v) => { field.handleChange(v); handleBlur(); }}
              placeholder="Select a model"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="systemPrompt">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>System Prompt</Label>
            <Textarea
              id={field.name}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="You are a helpful assistant..."
              rows={4}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="temperature">
        {(field) => (
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Temperature</Label>
              <span className="text-xs text-muted-foreground">{field.state.value ?? 0.7}</span>
            </div>
            <Slider
              min={0}
              max={2}
              step={0.1}
              value={[field.state.value ?? 0.7]}
              onValueChange={(vals) => {
                const v = Array.isArray(vals) ? vals[0] : (vals as number);
                field.handleChange(v);
                handleBlur();
              }}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="maxTokens">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Max Tokens</Label>
            <Input
              id={field.name}
              type="number"
              min={1}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="Leave blank for default"
            />
          </div>
        )}
      </form.Field>
    </form>
  );
}

'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { ProviderModelSelect } from '@/components/llm-providers/provider-model-select';
import type { LlmNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  model: z.string().min(1, 'Model is required'),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  contextChannels: z.array(z.string()).optional(),
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
      contextChannels: config.contextChannels ?? [],
    } as LlmFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'llm',
        model: value.model,
        systemPrompt: value.systemPrompt || undefined,
        temperature: value.temperature,
        maxTokens: value.maxTokens || undefined,
        contextChannels: value.contextChannels?.filter(Boolean).length
          ? value.contextChannels.filter(Boolean)
          : undefined,
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

      <form.Field name="contextChannels">
        {(field) => {
          const channels = (field.state.value ?? []) as string[];
          return (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label>Context Channels</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    form.setFieldValue('contextChannels', [...channels, '']);
                    setTimeout(handleBlur, 0);
                  }}
                >
                  + Add
                </Button>
              </div>
              {channels.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Add the outputChannel name from an upstream KB, HTTP, or Code node (e.g.{' '}
                  <span className="font-mono">kb_results</span>).
                </p>
              ) : (
                channels.map((ch, idx) => (
                  <div key={idx} className="flex gap-1.5">
                    <Input
                      value={ch}
                      onChange={(e) => {
                        const next = [...channels];
                        next[idx] = e.target.value;
                        form.setFieldValue('contextChannels', next);
                      }}
                      onBlur={() => { field.handleBlur(); handleBlur(); }}
                      placeholder="e.g. kb_results"
                      className="flex-1 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 px-0 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        form.setFieldValue(
                          'contextChannels',
                          channels.filter((_, i) => i !== idx),
                        );
                        setTimeout(handleBlur, 0);
                      }}
                    >
                      ×
                    </Button>
                  </div>
                ))
              )}
            </div>
          );
        }}
      </form.Field>
    </form>
  );
}

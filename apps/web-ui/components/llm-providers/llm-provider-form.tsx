'use client';

import { z } from 'zod';
import { useForm } from '@tanstack/react-form';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  provider: z.enum(['bedrock', 'openai']),
  chatModel: z.string().optional().nullable(),
  embeddingModel: z.string().optional().nullable(),
  embeddingDimensions: z.number().optional().nullable(),
  baseUrl: z.string().optional().nullable(),
  apiKey: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

interface LlmProviderFormProps {
  defaultValues?: Partial<FormValues>;
  onSubmit: (values: FormValues) => void;
  loading?: boolean;
  submitLabel?: string;
}

export function LlmProviderForm({ defaultValues, onSubmit, loading, submitLabel = 'Save' }: LlmProviderFormProps) {
  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? '',
      provider: defaultValues?.provider ?? 'bedrock',
      chatModel: defaultValues?.chatModel ?? '',
      embeddingModel: defaultValues?.embeddingModel ?? '',
      embeddingDimensions: defaultValues?.embeddingDimensions ?? undefined,
      baseUrl: defaultValues?.baseUrl ?? '',
      apiKey: defaultValues?.apiKey ?? '',
      isDefault: defaultValues?.isDefault ?? false,
    } as FormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => onSubmit(value),
  });

  const provider = form.getFieldValue('provider');

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-6">
      <form.Field name="name">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Name</Label>
            <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="My LLM Provider" />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="provider">
        {(field) => (
          <div className="grid gap-1.5">
            <Label>Provider</Label>
            <Select value={field.state.value} onValueChange={(v) => field.handleChange(v as 'bedrock' | 'openai')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bedrock">Amazon Bedrock</SelectItem>
                <SelectItem value="openai">OpenAI Compatible</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <form.Field name="chatModel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Chat Model</Label>
            <Input id={field.name} value={field.state.value ?? ''} onChange={(e) => field.handleChange(e.target.value || null)} placeholder={provider === 'bedrock' ? 'anthropic.claude-sonnet-4-20250514' : 'gpt-4o'} />
          </div>
        )}
      </form.Field>

      <form.Field name="embeddingModel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Embedding Model</Label>
            <Input id={field.name} value={field.state.value ?? ''} onChange={(e) => field.handleChange(e.target.value || null)} placeholder={provider === 'bedrock' ? 'amazon.titan-embed-text-v2:0' : 'text-embedding-3-large'} />
          </div>
        )}
      </form.Field>

      <form.Field name="embeddingDimensions">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Embedding Dimensions</Label>
            <Input id={field.name} type="number" value={field.state.value ?? ''} onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : null)} placeholder={provider === 'bedrock' ? '1024' : '3072'} />
          </div>
        )}
      </form.Field>

      {provider === 'openai' && (
        <>
          <form.Field name="baseUrl">
            {(field) => (
              <div className="grid gap-1.5">
                <Label htmlFor={field.name}>Base URL</Label>
                <Input id={field.name} value={field.state.value ?? ''} onChange={(e) => field.handleChange(e.target.value || null)} placeholder="http://localhost:11434/v1" />
              </div>
            )}
          </form.Field>

          <form.Field name="apiKey">
            {(field) => (
              <div className="grid gap-1.5">
                <Label htmlFor={field.name}>API Key</Label>
                <Input id={field.name} type="password" value={field.state.value ?? ''} onChange={(e) => field.handleChange(e.target.value || null)} placeholder="sk-..." />
              </div>
            )}
          </form.Field>
        </>
      )}

      <form.Field name="isDefault">
        {(field) => (
          <div className="flex items-center gap-3">
            <Switch id={field.name} checked={field.state.value} onCheckedChange={(v) => field.handleChange(v)} />
            <Label htmlFor={field.name}>Set as default provider</Label>
          </div>
        )}
      </form.Field>

      <Button type="submit" disabled={loading}>{loading ? 'Saving...' : submitLabel}</Button>
    </form>
  );
}

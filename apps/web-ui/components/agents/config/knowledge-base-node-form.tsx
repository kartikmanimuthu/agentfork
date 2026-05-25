'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import type { KnowledgeBaseNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  knowledgeBaseIds: z.string(),
  queryChannel: z.string().min(1, 'Query channel is required'),
  outputChannel: z.string().min(1, 'Output channel is required'),
  topK: z.number().int().positive(),
  threshold: z.number().min(0).max(1).optional(),
});

type KbFormValues = z.infer<typeof schema>;

interface KnowledgeBaseNodeFormProps {
  config: KnowledgeBaseNodeConfig;
  onChange: (config: KnowledgeBaseNodeConfig) => void;
}

export function KnowledgeBaseNodeForm({ config, onChange }: KnowledgeBaseNodeFormProps) {
  const form = useForm({
    defaultValues: {
      knowledgeBaseIds: config.knowledgeBaseIds.join(', '),
      queryChannel: config.queryChannel ?? 'query',
      outputChannel: config.outputChannel ?? 'kb_results',
      topK: config.topK ?? 5,
      threshold: config.threshold,
    } as KbFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      const ids = value.knowledgeBaseIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      onChange({
        type: 'knowledge_base',
        knowledgeBaseIds: ids,
        queryChannel: value.queryChannel,
        outputChannel: value.outputChannel,
        topK: value.topK,
        threshold: value.threshold,
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
      <form.Field name="knowledgeBaseIds">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Knowledge Base IDs</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="kb-id-1, kb-id-2 (empty = agent KBs)"
            />
          </div>
        )}
      </form.Field>

      <form.Field name="queryChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Query Channel</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="query"
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
              placeholder="kb_results"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="topK">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Top K</Label>
            <Input
              id={field.name}
              type="number"
              min={1}
              max={50}
              value={field.state.value}
              onChange={(e) => field.handleChange(Number(e.target.value))}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="5"
            />
          </div>
        )}
      </form.Field>

      <form.Field name="threshold">
        {(field) => (
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Similarity Threshold</Label>
              <span className="text-xs text-muted-foreground">
                {field.state.value != null ? field.state.value.toFixed(2) : 'KB default'}
              </span>
            </div>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[field.state.value ?? 0.5]}
              onValueChange={(values) => {
                const v = Array.isArray(values) ? values[0] : values;
                field.handleChange(v);
                handleBlur();
              }}
            />
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground text-left"
              onClick={() => { field.handleChange(undefined); handleBlur(); }}
            >
              {field.state.value != null ? '✕ Clear (use KB default)' : ''}
            </button>
          </div>
        )}
      </form.Field>
    </form>
  );
}

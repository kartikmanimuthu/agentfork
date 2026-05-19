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
import type { OutputNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  responseChannel: z.string().min(1, 'Response channel is required'),
  format: z.enum(['text', 'json', 'stream']),
});

type OutputFormValues = z.infer<typeof schema>;

interface OutputNodeFormProps {
  config: OutputNodeConfig;
  onChange: (config: OutputNodeConfig) => void;
}

export function OutputNodeForm({ config, onChange }: OutputNodeFormProps) {
  const form = useForm({
    defaultValues: {
      responseChannel: config.responseChannel ?? '',
      format: config.format ?? 'text',
    } as OutputFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'output',
        responseChannel: value.responseChannel,
        format: value.format,
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
      <form.Field name="responseChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Response Channel</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="response"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="format">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Format</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                field.handleChange(v as OutputFormValues['format']);
                handleBlur();
              }}
            >
              <SelectTrigger aria-label="Output format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
                <SelectItem value="stream">Stream</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>
    </form>
  );
}

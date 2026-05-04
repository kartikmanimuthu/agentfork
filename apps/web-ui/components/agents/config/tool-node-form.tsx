'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { ToolNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  toolName: z.string().min(1, 'Tool name is required'),
});

interface ToolNodeFormProps {
  config: ToolNodeConfig;
  onChange: (config: ToolNodeConfig) => void;
}

export function ToolNodeForm({ config, onChange }: ToolNodeFormProps) {
  const form = useForm({
    defaultValues: {
      toolName: config.toolName ?? '',
    },
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({ type: 'tool', toolName: value.toolName });
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
      <form.Field name="toolName">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Tool Name</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="search, calculator, ..."
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

'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { ConditionNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  expression: z.string().min(1, 'Expression is required'),
  trueBranch: z.string().min(1, 'True branch is required'),
  falseBranch: z.string().min(1, 'False branch is required'),
});

type ConditionFormValues = z.infer<typeof schema>;

interface ConditionNodeFormProps {
  config: ConditionNodeConfig;
  onChange: (config: ConditionNodeConfig) => void;
}

export function ConditionNodeForm({ config, onChange }: ConditionNodeFormProps) {
  const form = useForm({
    defaultValues: {
      expression: config.expression ?? '',
      trueBranch: config.trueBranch ?? '',
      falseBranch: config.falseBranch ?? '',
    } as ConditionFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'condition',
        expression: value.expression,
        trueBranch: value.trueBranch,
        falseBranch: value.falseBranch,
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
      <form.Field name="expression">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Expression</Label>
            <Textarea
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="score > 0.8"
              className="font-mono text-xs min-h-[80px]"
              rows={3}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="trueBranch">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>True Branch (Node ID)</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="node_id_if_true"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="falseBranch">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>False Branch (Node ID)</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="node_id_if_false"
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

'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import type { RouterNodeConfig } from '@chatbot/agent-studio';

const conditionSchema = z.object({
  condition: z.string().min(1, 'Condition is required'),
  target: z.string().min(1, 'Target node is required'),
});

const schema = z.object({
  conditions: z.array(conditionSchema).min(1, 'At least one condition is required'),
  defaultTarget: z.string().optional(),
});

type RouterFormValues = z.infer<typeof schema>;

interface RouterNodeFormProps {
  config: RouterNodeConfig;
  onChange: (config: RouterNodeConfig) => void;
}

export function RouterNodeForm({ config, onChange }: RouterNodeFormProps) {
  const form = useForm({
    defaultValues: {
      conditions: config.conditions ?? [],
      defaultTarget: config.defaultTarget ?? '',
    } as RouterFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'router',
        conditions: value.conditions,
        defaultTarget: value.defaultTarget || undefined,
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
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label>Conditions</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              const current = form.getFieldValue('conditions') as RouterFormValues['conditions'];
              form.setFieldValue('conditions', [...current, { condition: '', target: '' }]);
            }}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        </div>

        <form.Field name="conditions" mode="array">
          {(field) => (
            <div className="space-y-2">
              {(field.state.value as RouterFormValues['conditions']).map((_, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="flex-1 grid gap-1">
                    <form.Field name={`conditions[${i}].condition`}>
                      {(condField) => (
                        <Input
                          value={condField.state.value as string}
                          onChange={(e) => condField.handleChange(e.target.value)}
                          onBlur={() => { condField.handleBlur(); handleBlur(); }}
                          placeholder="x > 0"
                          className="h-8 text-xs"
                          aria-label={`Condition ${i + 1}`}
                        />
                      )}
                    </form.Field>
                    <form.Field name={`conditions[${i}].target`}>
                      {(targetField) => (
                        <Input
                          value={targetField.state.value as string}
                          onChange={(e) => targetField.handleChange(e.target.value)}
                          onBlur={() => { targetField.handleBlur(); handleBlur(); }}
                          placeholder="target-node-id"
                          className="h-8 text-xs"
                          aria-label={`Target ${i + 1}`}
                        />
                      )}
                    </form.Field>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive shrink-0 mt-0.5"
                    onClick={() => {
                      const current = form.getFieldValue('conditions') as RouterFormValues['conditions'];
                      form.setFieldValue('conditions', current.filter((_: unknown, j: number) => j !== i));
                      handleBlur();
                    }}
                    aria-label={`Remove condition ${i + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {(field.state.value as RouterFormValues['conditions']).length === 0 && (
                <p className="text-xs text-muted-foreground italic">No conditions yet.</p>
              )}
            </div>
          )}
        </form.Field>
      </div>

      <form.Field name="defaultTarget">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Default Target (optional)</Label>
            <Input
              id={field.name}
              value={field.state.value as string ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="fallback-node-id"
            />
          </div>
        )}
      </form.Field>
    </form>
  );
}

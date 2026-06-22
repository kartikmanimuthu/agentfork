'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2 } from 'lucide-react';
import { NodePicker } from './node-picker';
import type { NodeOption } from './node-picker';
import { ProviderModelSelect } from '@/components/llm-providers/provider-model-select';
import type { RouterNodeConfig } from '@chatbot/agent-studio';

const conditionSchema = z.object({
  condition: z.string().min(1, 'Condition is required'),
  target: z.string().min(1, 'Target node is required'),
});

const schema = z.object({
  mode: z.enum(['expression', 'natural_language']),
  conditions: z.array(conditionSchema).min(1, 'At least one condition is required'),
  defaultTarget: z.string().optional(),
  nlTemperature: z.number().min(0).max(1),
  classifierModel: z.string().optional(),
});

type RouterFormValues = z.infer<typeof schema>;

interface RouterNodeFormProps {
  config: RouterNodeConfig;
  onChange: (config: RouterNodeConfig) => void;
  allNodes: NodeOption[];
}

export function RouterNodeForm({ config, onChange, allNodes }: RouterNodeFormProps) {
  const form = useForm({
    defaultValues: {
      mode: config.mode ?? 'expression',
      conditions: config.conditions ?? [],
      defaultTarget: config.defaultTarget ?? '',
      nlTemperature: config.nlTemperature ?? 0,
      classifierModel: config.classifierModel ?? '',
    } as RouterFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'router',
        mode: value.mode,
        conditions: value.conditions,
        defaultTarget: value.defaultTarget || undefined,
        nlTemperature: value.nlTemperature,
        classifierModel: value.classifierModel || undefined,
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
      {/* Mode toggle */}
      <form.Field name="mode">
        {(field) => (
          <div className="flex items-center justify-between">
            <div className="grid gap-0.5">
              <Label>Natural Language Mode</Label>
              <p className="text-xs text-muted-foreground">
                {field.state.value === 'natural_language'
                  ? 'Write conditions in plain English — LLM classifies at runtime'
                  : 'Write conditions as JS expressions (e.g. score > 0.8)'}
              </p>
            </div>
            <Switch
              checked={field.state.value === 'natural_language'}
              onCheckedChange={(checked) => {
                field.handleChange(checked ? 'natural_language' : 'expression');
                handleBlur();
              }}
            />
          </div>
        )}
      </form.Field>

      {/* NL Temperature + Classifier Model — only visible in natural_language mode */}
      <form.Subscribe selector={(s) => s.values.mode}>
        {(mode) =>
          mode === 'natural_language' ? (
            <>
              <form.Field name="classifierModel">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Classifier Model</Label>
                    <ProviderModelSelect
                      capability="chat"
                      value={(field.state.value as string) || undefined}
                      onChange={(v) => { field.handleChange(v); handleBlur(); }}
                      placeholder="Select classifier model…"
                    />
                    <p className="text-xs text-muted-foreground">
                      Model used for NLP routing classification.
                    </p>
                  </div>
                )}
              </form.Field>
              <form.Field name="nlTemperature">
                {(field) => (
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between">
                      <Label>Classifier Temperature: {(field.state.value as number).toFixed(1)}</Label>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.1}
                      value={field.state.value as number}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                      onMouseUp={() => handleBlur()}
                      className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0 (precise)</span>
                      <span>1 (creative)</span>
                    </div>
                  </div>
                )}
              </form.Field>
            </>
          ) : null
        }
      </form.Subscribe>

      {/* Conditions */}
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
                        <>
                          <form.Subscribe selector={(s) => s.values.mode}>
                            {(mode) => (
                              <Input
                                value={condField.state.value as string}
                                onChange={(e) => condField.handleChange(e.target.value)}
                                onBlur={() => { condField.handleBlur(); handleBlur(); }}
                                placeholder={
                                  mode === 'natural_language'
                                    ? 'e.g. user is asking about billing'
                                    : 'e.g. score > 0.8'
                                }
                                className="h-8 text-xs"
                                aria-label={`Condition ${i + 1}`}
                              />
                            )}
                          </form.Subscribe>
                          {condField.state.meta.errors.length > 0 && (
                            <p className="text-xs text-destructive">{String(condField.state.meta.errors[0])}</p>
                          )}
                        </>
                      )}
                    </form.Field>
                    <form.Field name={`conditions[${i}].target`}>
                      {(targetField) => (
                        <>
                          <NodePicker
                            nodes={allNodes}
                            value={targetField.state.value as string}
                            onChange={(id) => {
                              targetField.handleChange(id);
                              handleBlur();
                            }}
                            placeholder="Target node…"
                            className="h-8 text-xs"
                          />
                          {targetField.state.meta.errors.length > 0 && (
                            <p className="text-xs text-destructive">{String(targetField.state.meta.errors[0])}</p>
                          )}
                        </>
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
              {field.state.meta.errors.length > 0 && (
                <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
              )}
            </div>
          )}
        </form.Field>
      </div>

      {/* Default target */}
      <form.Field name="defaultTarget">
        {(field) => (
          <div className="grid gap-1.5">
            <Label>Default Target (optional)</Label>
            <NodePicker
              nodes={allNodes}
              value={field.state.value as string ?? ''}
              onChange={(id) => {
                field.handleChange(id);
                handleBlur();
              }}
              placeholder="Fallback node…"
            />
          </div>
        )}
      </form.Field>
    </form>
  );
}

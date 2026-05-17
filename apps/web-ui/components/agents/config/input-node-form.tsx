'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import type { InputNodeConfig, SchemaField } from '@chatbot/agent-studio';

const fieldSchema = z.object({
  name: z.string().min(1, 'Field name is required'),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
  required: z.boolean().optional(),
  description: z.string().optional(),
});

const schema = z.object({
  mode: z.enum(['messages', 'structured']),
  inputSchema: z.array(fieldSchema).optional(),
});

type InputFormValues = z.infer<typeof schema>;

const FIELD_TYPES = ['string', 'number', 'boolean', 'array', 'object'] as const;

interface InputNodeFormProps {
  config: InputNodeConfig;
  onChange: (config: InputNodeConfig) => void;
}

export function InputNodeForm({ config, onChange }: InputNodeFormProps) {
  const form = useForm({
    defaultValues: {
      mode: config.mode ?? 'messages',
      inputSchema: (config.inputSchema ?? []) as InputFormValues['inputSchema'],
    } as InputFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'input',
        mode: value.mode,
        inputSchema: value.mode === 'structured' ? (value.inputSchema as SchemaField[]) : undefined,
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
      <form.Field name="mode">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Mode</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                field.handleChange(v as InputFormValues['mode']);
                handleBlur();
              }}
            >
              <SelectTrigger aria-label="Input mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="messages">Messages</SelectItem>
                <SelectItem value="structured">Structured</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <form.Field name="mode">
        {(modeField) =>
          modeField.state.value === 'structured' ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Input Schema</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    const current = form.getFieldValue('inputSchema') ?? [];
                    form.setFieldValue('inputSchema', [...current, { name: '', type: 'string' as const }]);
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Field
                </Button>
              </div>

              <form.Field name="inputSchema" mode="array">
                {(field) => (
                  <div className="space-y-2">
                    {((field.state.value ?? []) as NonNullable<InputFormValues['inputSchema']>).map((_, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <form.Field name={`inputSchema[${i}].name`}>
                          {(nameField) => (
                            <Input
                              value={nameField.state.value as string}
                              onChange={(e) => nameField.handleChange(e.target.value)}
                              onBlur={() => { nameField.handleBlur(); handleBlur(); }}
                              placeholder="fieldName"
                              className="h-8 text-xs flex-1"
                              aria-label={`Field ${i + 1} name`}
                            />
                          )}
                        </form.Field>

                        <form.Field name={`inputSchema[${i}].type`}>
                          {(typeField) => (
                            <Select
                              value={typeField.state.value as string}
                              onValueChange={(v) => {
                                typeField.handleChange(v);
                                handleBlur();
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs w-28" aria-label={`Field ${i + 1} type`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FIELD_TYPES.map((t) => (
                                  <SelectItem key={t} value={t} className="text-xs">
                                    {t}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </form.Field>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive shrink-0"
                          onClick={() => {
                            const current = form.getFieldValue('inputSchema') ?? [];
                            form.setFieldValue('inputSchema', current.filter((_: unknown, j: number) => j !== i));
                            handleBlur();
                          }}
                          aria-label={`Remove field ${i + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </form.Field>
            </div>
          ) : null
        }
      </form.Field>
    </form>
  );
}

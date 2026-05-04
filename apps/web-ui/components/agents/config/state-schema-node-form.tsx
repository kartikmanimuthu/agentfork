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
import type { StateSchemaNodeConfig, SchemaField } from '@chatbot/agent-studio';

const fieldSchema = z.object({
  name: z.string().min(1, 'Field name is required'),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
  required: z.boolean().optional(),
  description: z.string().optional(),
});

const schema = z.object({
  fields: z.array(fieldSchema).min(1, 'At least one field is required'),
});

type StateSchemaFormValues = z.infer<typeof schema>;

const FIELD_TYPES = ['string', 'number', 'boolean', 'array', 'object'] as const;

interface StateSchemaNodeFormProps {
  config: StateSchemaNodeConfig;
  onChange: (config: StateSchemaNodeConfig) => void;
}

export function StateSchemaNodeForm({ config, onChange }: StateSchemaNodeFormProps) {
  const form = useForm({
    defaultValues: {
      fields: (config.fields ?? []) as StateSchemaFormValues['fields'],
    } as StateSchemaFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({ type: 'state_schema', fields: value.fields as SchemaField[] });
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
          <Label>Fields</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              const current = form.getFieldValue('fields') as StateSchemaFormValues['fields'];
              form.setFieldValue('fields', [...current, { name: '', type: 'string' as const }]);
            }}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Field
          </Button>
        </div>

        <form.Field name="fields" mode="array">
          {(field) => (
            <div className="space-y-2">
              {(field.state.value as StateSchemaFormValues['fields']).map((_, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <form.Field name={`fields[${i}].name`}>
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

                  <form.Field name={`fields[${i}].type`}>
                    {(typeField) => (
                      <Select
                        value={typeField.state.value as string}
                        onValueChange={(v) => {
                          typeField.handleChange(v as StateSchemaFormValues['fields'][number]['type']);
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
                      const current = form.getFieldValue('fields') as StateSchemaFormValues['fields'];
                      form.setFieldValue('fields', current.filter((_: unknown, j: number) => j !== i));
                      handleBlur();
                    }}
                    aria-label={`Remove field ${i + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {(field.state.value as StateSchemaFormValues['fields']).length === 0 && (
                <p className="text-xs text-muted-foreground italic">No fields yet.</p>
              )}
            </div>
          )}
        </form.Field>
      </div>
    </form>
  );
}

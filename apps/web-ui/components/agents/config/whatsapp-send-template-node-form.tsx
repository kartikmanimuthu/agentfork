'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { WhatsAppSendTemplateNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  templateName: z.string().min(1, 'Template name is required'),
  languageCode: z.string().min(2, 'Language code is required'),
  componentsChannel: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  config: WhatsAppSendTemplateNodeConfig;
  onChange: (config: WhatsAppSendTemplateNodeConfig) => void;
}

export function WhatsAppSendTemplateNodeForm({ config, onChange }: Props) {
  const form = useForm({
    defaultValues: {
      templateName: config.templateName ?? '',
      languageCode: config.languageCode ?? 'en',
      componentsChannel: config.componentsChannel ?? '',
    } as FormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'whatsapp_send_template',
        templateName: value.templateName,
        languageCode: value.languageCode,
        componentsChannel: value.componentsChannel || undefined,
      });
    },
  });

  const handleBlur = () => form.handleSubmit();

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4">
      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Works outside the 24-hour customer service window. Template must be approved in your Meta Business account.
      </div>

      <form.Field name="templateName">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Template Name</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="hello_world"
            />
            <p className="text-[10px] text-muted-foreground">Exact name of the approved Meta template</p>
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="languageCode">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Language Code</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="en"
            />
            <p className="text-[10px] text-muted-foreground">e.g. en, en_US, hi, ar</p>
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="componentsChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Components Channel</Label>
            <Input
              id={field.name}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="optional"
            />
            <p className="text-[10px] text-muted-foreground">Channel with template variable components as a JSON array. Leave blank for templates with no variables.</p>
          </div>
        )}
      </form.Field>
    </form>
  );
}

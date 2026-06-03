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
import type { WhatsAppSendNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  messageType: z.enum(['text', 'image', 'document', 'audio', 'video']),
  messageChannel: z.string().min(1, 'Message channel is required'),
  mediaIdChannel: z.string().optional(),
  filenameChannel: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  config: WhatsAppSendNodeConfig;
  onChange: (config: WhatsAppSendNodeConfig) => void;
}

export function WhatsAppSendNodeForm({ config, onChange }: Props) {
  const form = useForm({
    defaultValues: {
      messageType: config.messageType ?? 'text',
      messageChannel: config.messageChannel ?? 'llm_output',
      mediaIdChannel: config.mediaIdChannel ?? '',
      filenameChannel: config.filenameChannel ?? '',
    } as FormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'whatsapp_send',
        messageType: value.messageType,
        messageChannel: value.messageChannel,
        mediaIdChannel: value.mediaIdChannel || undefined,
        filenameChannel: value.filenameChannel || undefined,
      });
    },
  });

  const handleBlur = () => form.handleSubmit();

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4">
      <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
        Only valid within the 24-hour customer service window. Use <strong>WhatsApp Send Template</strong> to contact customers outside that window.
      </div>

      <form.Field name="messageType">
        {(field) => (
          <div className="grid gap-1.5">
            <Label>Message Type</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => { field.handleChange(v as FormValues['messageType']); handleBlur(); }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="image">Image</SelectItem>
                <SelectItem value="document">Document</SelectItem>
                <SelectItem value="audio">Audio</SelectItem>
                <SelectItem value="video">Video</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <form.Field name="messageChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Message Channel</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="llm_output"
            />
            <p className="text-[10px] text-muted-foreground">Channel containing the text body (or caption for media)</p>
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="mediaIdChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Media ID Channel</Label>
            <Input
              id={field.name}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="wa_media_id"
            />
            <p className="text-[10px] text-muted-foreground">Required for image / document / audio / video types</p>
          </div>
        )}
      </form.Field>

      <form.Field name="filenameChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Filename Channel</Label>
            <Input
              id={field.name}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="optional"
            />
            <p className="text-[10px] text-muted-foreground">Document filename (document type only)</p>
          </div>
        )}
      </form.Field>
    </form>
  );
}

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
import type { TelegramSendNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  messageChannel: z.string().min(1, 'Message channel is required'),
  parseMode: z.enum(['Markdown', 'HTML']).optional(),
  replyToChannel: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  config: TelegramSendNodeConfig;
  onChange: (config: TelegramSendNodeConfig) => void;
}

export function TelegramSendNodeForm({ config, onChange }: Props) {
  const form = useForm({
    defaultValues: {
      messageChannel: config.messageChannel ?? 'response',
      parseMode: config.parseMode ?? undefined,
      replyToChannel: config.replyToChannel ?? '',
    } as FormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'telegram_send',
        messageChannel: value.messageChannel,
        parseMode: value.parseMode,
        replyToChannel: value.replyToChannel || undefined,
      });
    },
  });

  const handleBlur = () => form.handleSubmit();

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4">
      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Sends a Telegram message. Reads message text from the named state channel.
        The channel <code className="font-mono">tg_chat_id</code> and <code className="font-mono">tg_account_id</code> are injected automatically by the trigger node.
      </div>

      <form.Field name="messageChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Message Channel</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="response"
            />
            <p className="text-[10px] text-muted-foreground">State channel holding the message text (e.g. <code className="font-mono">response</code> from an LLM node)</p>
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="parseMode">
        {(field) => (
          <div className="grid gap-1.5">
            <Label>Parse Mode</Label>
            <Select
              value={field.state.value ?? ''}
              onValueChange={(v) => { field.handleChange(v as FormValues['parseMode']); handleBlur(); }}
            >
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                <SelectItem value="Markdown">Markdown</SelectItem>
                <SelectItem value="HTML">HTML</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <form.Field name="replyToChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Reply-To Channel</Label>
            <Input
              id={field.name}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="optional — channel holding a message_id to reply to"
            />
          </div>
        )}
      </form.Field>
    </form>
  );
}

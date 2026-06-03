'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { WhatsAppTriggerNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  senderIdChannel: z.string().optional(),
  messageTextChannel: z.string().optional(),
  messageTypeChannel: z.string().optional(),
  mediaIdChannel: z.string().optional(),
  withinWindowChannel: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  config: WhatsAppTriggerNodeConfig;
  onChange: (config: WhatsAppTriggerNodeConfig) => void;
}

export function WhatsAppTriggerNodeForm({ config, onChange }: Props) {
  const map = config.channelMap ?? {};

  const form = useForm({
    defaultValues: {
      senderIdChannel: map.senderIdChannel ?? '',
      messageTextChannel: map.messageTextChannel ?? '',
      messageTypeChannel: map.messageTypeChannel ?? '',
      mediaIdChannel: map.mediaIdChannel ?? '',
      withinWindowChannel: map.withinWindowChannel ?? '',
    } as FormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      const channelMap: WhatsAppTriggerNodeConfig['channelMap'] = {};
      if (value.senderIdChannel) channelMap.senderIdChannel = value.senderIdChannel;
      if (value.messageTextChannel) channelMap.messageTextChannel = value.messageTextChannel;
      if (value.messageTypeChannel) channelMap.messageTypeChannel = value.messageTypeChannel;
      if (value.mediaIdChannel) channelMap.mediaIdChannel = value.mediaIdChannel;
      if (value.withinWindowChannel) channelMap.withinWindowChannel = value.withinWindowChannel;
      onChange({ type: 'whatsapp_trigger', channelMap: Object.keys(channelMap).length ? channelMap : undefined });
    },
  });

  const handleBlur = () => form.handleSubmit();

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4">
      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Available channels (auto-populated)</p>
        <p><code className="font-mono">wa_sender_id</code> — customer phone</p>
        <p><code className="font-mono">wa_message_text</code> — message body</p>
        <p><code className="font-mono">wa_message_type</code> — text / image / etc.</p>
        <p><code className="font-mono">wa_media_id</code> — media ID if media message</p>
        <p><code className="font-mono">wa_within_window</code> — true if within 24h window</p>
      </div>

      <p className="text-xs text-muted-foreground">Optionally remap channels to custom names. Leave blank to use defaults above.</p>

      {[
        { name: 'senderIdChannel' as const, label: 'Sender ID Channel', placeholder: 'wa_sender_id' },
        { name: 'messageTextChannel' as const, label: 'Message Text Channel', placeholder: 'wa_message_text' },
        { name: 'messageTypeChannel' as const, label: 'Message Type Channel', placeholder: 'wa_message_type' },
        { name: 'mediaIdChannel' as const, label: 'Media ID Channel', placeholder: 'wa_media_id' },
        { name: 'withinWindowChannel' as const, label: 'Within Window Channel', placeholder: 'wa_within_window' },
      ].map(({ name, label, placeholder }) => (
        <form.Field key={name} name={name}>
          {(field) => (
            <div className="grid gap-1.5">
              <Label htmlFor={field.name}>{label}</Label>
              <Input
                id={field.name}
                value={field.state.value ?? ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={() => { field.handleBlur(); handleBlur(); }}
                placeholder={placeholder}
              />
            </div>
          )}
        </form.Field>
      ))}
    </form>
  );
}

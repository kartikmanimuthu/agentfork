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
import type { TelegramTriggerNodeConfig } from '@chatbot/agent-studio';
import { useTelegramAccounts } from '@/hooks/use-telegram-accounts';

const schema = z.object({
  accountId: z.string().optional(),
  chatIdChannel: z.string().optional(),
  textChannel: z.string().optional(),
  messageTypeChannel: z.string().optional(),
  mediaIdChannel: z.string().optional(),
  callbackDataChannel: z.string().optional(),
  fromNameChannel: z.string().optional(),
  isGroupChannel: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  config: TelegramTriggerNodeConfig;
  agentId: string;
  onChange: (config: TelegramTriggerNodeConfig) => void;
}

export function TelegramTriggerNodeForm({ config, agentId, onChange }: Props) {
  const map = config.channelMap ?? {};
  const { data: accounts, isLoading: accountsLoading } = useTelegramAccounts();

  const selectableAccounts = (accounts ?? []).filter(
    (a) => a.agentId === null || a.agentId === agentId,
  );

  const form = useForm({
    defaultValues: {
      accountId: config.accountId ?? '',
      chatIdChannel: map.chatIdChannel ?? '',
      textChannel: map.textChannel ?? '',
      messageTypeChannel: map.messageTypeChannel ?? '',
      mediaIdChannel: map.mediaIdChannel ?? '',
      callbackDataChannel: map.callbackDataChannel ?? '',
      fromNameChannel: map.fromNameChannel ?? '',
      isGroupChannel: map.isGroupChannel ?? '',
    } as FormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      const channelMap: TelegramTriggerNodeConfig['channelMap'] = {};
      if (value.chatIdChannel) channelMap.chatIdChannel = value.chatIdChannel;
      if (value.textChannel) channelMap.textChannel = value.textChannel;
      if (value.messageTypeChannel) channelMap.messageTypeChannel = value.messageTypeChannel;
      if (value.mediaIdChannel) channelMap.mediaIdChannel = value.mediaIdChannel;
      if (value.callbackDataChannel) channelMap.callbackDataChannel = value.callbackDataChannel;
      if (value.fromNameChannel) channelMap.fromNameChannel = value.fromNameChannel;
      if (value.isGroupChannel) channelMap.isGroupChannel = value.isGroupChannel;
      onChange({
        type: 'telegram_trigger',
        accountId: value.accountId || undefined,
        channelMap: Object.keys(channelMap).length ? channelMap : undefined,
      });
    },
  });

  const handleBlur = () => form.handleSubmit();

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4">
      <form.Field name="accountId">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Connected Bot</Label>
            <Select
              value={field.state.value ?? ''}
              onValueChange={(v) => { field.handleChange(v); handleBlur(); }}
              disabled={accountsLoading}
            >
              <SelectTrigger id={field.name} aria-label="Connected Bot">
                <SelectValue placeholder={accountsLoading ? 'Loading...' : 'Select a connected bot'} />
              </SelectTrigger>
              <SelectContent>
                {selectableAccounts.length === 0 && !accountsLoading && (
                  <SelectItem value="__empty__" disabled>No available bots — connect one first</SelectItem>
                )}
                {selectableAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.botName ?? account.botUsername ?? account.id}
                    {account.botUsername && <span className="ml-1 text-xs text-muted-foreground">@{account.botUsername}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Bots already connected to other agents are hidden. Connect new bots from Settings → Channels → Telegram.
            </p>
          </div>
        )}
      </form.Field>

      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Available channels (auto-populated)</p>
        <p><code className="font-mono">tg_chat_id</code> — chat ID</p>
        <p><code className="font-mono">tg_text</code> — message text</p>
        <p><code className="font-mono">tg_message_type</code> — text / photo / etc.</p>
        <p><code className="font-mono">tg_media_id</code> — media file_id if media message</p>
        <p><code className="font-mono">tg_callback_data</code> — button callback data</p>
        <p><code className="font-mono">tg_from_name</code> — sender name</p>
        <p><code className="font-mono">tg_is_group</code> — true if group chat</p>
      </div>

      <p className="text-xs text-muted-foreground">Optionally remap channels to custom names. Leave blank to use defaults above.</p>

      {[
        { name: 'chatIdChannel' as const, label: 'Chat ID Channel', placeholder: 'tg_chat_id' },
        { name: 'textChannel' as const, label: 'Text Channel', placeholder: 'tg_text' },
        { name: 'messageTypeChannel' as const, label: 'Message Type Channel', placeholder: 'tg_message_type' },
        { name: 'mediaIdChannel' as const, label: 'Media ID Channel', placeholder: 'tg_media_id' },
        { name: 'callbackDataChannel' as const, label: 'Callback Data Channel', placeholder: 'tg_callback_data' },
        { name: 'fromNameChannel' as const, label: 'From Name Channel', placeholder: 'tg_from_name' },
        { name: 'isGroupChannel' as const, label: 'Is Group Channel', placeholder: 'tg_is_group' },
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

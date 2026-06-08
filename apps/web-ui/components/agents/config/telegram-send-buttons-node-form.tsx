'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { TelegramSendButtonsNodeConfig } from '@chatbot/agent-studio';
import { Plus, Trash2 } from 'lucide-react';

const buttonSchema = z.object({
  text: z.string().min(1, 'Button text is required'),
  callbackData: z.string().min(1, 'Callback data is required'),
});

const schema = z.object({
  messageChannel: z.string().min(1, 'Message channel is required'),
  // buttons is stored as rows: [[btn, btn], [btn]]
  buttons: z.array(z.array(buttonSchema)).default([]),
  buttonsChannel: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

// Flatten rows → flat list for the form UI, then rebuild rows on save
type FlatButton = { text: string; callbackData: string };

interface Props {
  config: TelegramSendButtonsNodeConfig;
  onChange: (config: TelegramSendButtonsNodeConfig) => void;
}

export function TelegramSendButtonsNodeForm({ config, onChange }: Props) {
  const flatButtons: FlatButton[] = (config.buttons ?? []).flat();

  const form = useForm({
    defaultValues: {
      messageChannel: config.messageChannel ?? 'response',
      buttons: flatButtons,
      buttonsChannel: config.buttonsChannel ?? '',
    } as { messageChannel: string; buttons: FlatButton[]; buttonsChannel: string },
    onSubmit: ({ value }) => {
      // Each button goes in its own row (one button per row is standard for Telegram)
      const rows: Array<Array<{ text: string; callbackData: string }>> =
        value.buttons.map((b) => [{ text: b.text, callbackData: b.callbackData }]);
      onChange({
        type: 'telegram_send_buttons',
        messageChannel: value.messageChannel,
        buttons: rows,
        buttonsChannel: value.buttonsChannel || undefined,
      });
    },
  });

  const handleBlur = () => form.handleSubmit();

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4">
      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Sends a message with clickable inline buttons. When clicked, the graph runs again
        with <code className="font-mono">tg_callback_data</code> set to the button's callback value.
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
            <p className="text-[10px] text-muted-foreground">State channel holding the text shown above the buttons</p>
          </div>
        )}
      </form.Field>

      <form.Field name="buttons">
        {(field) => (
          <div className="grid gap-2">
            <Label>Buttons</Label>
            {(field.state.value ?? []).map((button, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  placeholder="Label"
                  value={button.text}
                  onChange={(e) => {
                    const next = [...field.state.value];
                    next[idx] = { ...next[idx], text: e.target.value };
                    field.handleChange(next);
                    handleBlur();
                  }}
                />
                <Input
                  placeholder="callback_data"
                  value={button.callbackData}
                  onChange={(e) => {
                    const next = [...field.state.value];
                    next[idx] = { ...next[idx], callbackData: e.target.value };
                    field.handleChange(next);
                    handleBlur();
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  className="h-8 w-8 text-destructive shrink-0"
                  onClick={() => {
                    field.handleChange(field.state.value.filter((_, i) => i !== idx));
                    handleBlur();
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              type="button"
              className="w-fit"
              onClick={() => {
                field.handleChange([...field.state.value, { text: '', callbackData: '' }]);
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Button
            </Button>
          </div>
        )}
      </form.Field>

      <form.Field name="buttonsChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Buttons Channel</Label>
            <Input
              id={field.name}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="optional"
            />
            <p className="text-[10px] text-muted-foreground">Channel with dynamic buttons as JSON array. Overrides the static list above when set.</p>
          </div>
        )}
      </form.Field>
    </form>
  );
}

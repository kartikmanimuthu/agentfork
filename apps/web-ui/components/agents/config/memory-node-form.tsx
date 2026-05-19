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
import type { MemoryNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  strategy: z.enum(['full', 'sliding_window', 'summary', 'token_limit']),
  maxMessages: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  messagesChannel: z.string().min(1, 'Messages channel is required'),
});

type MemoryFormValues = z.infer<typeof schema>;

interface MemoryNodeFormProps {
  config: MemoryNodeConfig;
  onChange: (config: MemoryNodeConfig) => void;
}

export function MemoryNodeForm({ config, onChange }: MemoryNodeFormProps) {
  const form = useForm({
    defaultValues: {
      strategy: config.strategy ?? 'full',
      maxMessages: config.maxMessages,
      maxTokens: config.maxTokens,
      messagesChannel: config.messagesChannel ?? 'messages',
    } as MemoryFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'memory',
        strategy: value.strategy,
        maxMessages: value.strategy === 'sliding_window' ? value.maxMessages : undefined,
        maxTokens: value.strategy === 'token_limit' ? value.maxTokens : undefined,
        messagesChannel: value.messagesChannel,
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
      <form.Field name="strategy">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Strategy</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                field.handleChange(v as MemoryFormValues['strategy']);
                handleBlur();
              }}
            >
              <SelectTrigger aria-label="Memory strategy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full</SelectItem>
                <SelectItem value="sliding_window">Sliding Window</SelectItem>
                <SelectItem value="summary">Summary</SelectItem>
                <SelectItem value="token_limit">Token Limit</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <form.Field name="strategy">
        {(strategyField) =>
          strategyField.state.value === 'sliding_window' ? (
            <form.Field name="maxMessages">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Max Messages</Label>
                  <Input
                    id={field.name}
                    type="number"
                    min={1}
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
                    onBlur={() => { field.handleBlur(); handleBlur(); }}
                    placeholder="20"
                  />
                </div>
              )}
            </form.Field>
          ) : strategyField.state.value === 'token_limit' ? (
            <form.Field name="maxTokens">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Max Tokens</Label>
                  <Input
                    id={field.name}
                    type="number"
                    min={1}
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
                    onBlur={() => { field.handleBlur(); handleBlur(); }}
                    placeholder="4000"
                  />
                </div>
              )}
            </form.Field>
          ) : null
        }
      </form.Field>

      <form.Field name="messagesChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Messages Channel</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="messages"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>
    </form>
  );
}

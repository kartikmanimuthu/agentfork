'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { SubAgentNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
  versionId: z.string().optional(),
  alias: z.string().optional(),
  inputChannel: z.string().min(1, 'Input channel is required'),
  outputChannel: z.string().min(1, 'Output channel is required'),
});

type SubAgentFormValues = z.infer<typeof schema>;

interface SubAgentNodeFormProps {
  config: SubAgentNodeConfig;
  onChange: (config: SubAgentNodeConfig) => void;
}

export function SubAgentNodeForm({ config, onChange }: SubAgentNodeFormProps) {
  const form = useForm({
    defaultValues: {
      agentId: config.agentId ?? '',
      versionId: config.versionId ?? '',
      alias: config.alias ?? '',
      inputChannel: config.inputChannel ?? 'messages',
      outputChannel: config.outputChannel ?? 'sub_agent_response',
    } as SubAgentFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'sub_agent',
        agentId: value.agentId,
        versionId: value.versionId || undefined,
        alias: value.alias || undefined,
        inputChannel: value.inputChannel,
        outputChannel: value.outputChannel,
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
      <form.Field name="agentId">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Agent ID</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="agent-uuid"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="versionId">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Version ID</Label>
            <Input
              id={field.name}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="Optional version"
            />
          </div>
        )}
      </form.Field>

      <form.Field name="alias">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Alias</Label>
            <Input
              id={field.name}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="Optional display name"
            />
          </div>
        )}
      </form.Field>

      <form.Field name="inputChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Input Channel</Label>
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

      <form.Field name="outputChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Output Channel</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="sub_agent_response"
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

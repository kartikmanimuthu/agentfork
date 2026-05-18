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
import { Textarea } from '@/components/ui/textarea';
import type { McpServerNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  serverId: z.string().min(1, 'Server ID is required'),
  toolName: z.string().min(1, 'Tool name is required'),
  argumentSource: z.enum(['from_state', 'static']),
  staticArguments: z.string().optional(),
  channelMappings: z.string().optional(),
  outputChannel: z.string().min(1, 'Output channel is required'),
});

type McpFormValues = z.infer<typeof schema>;

interface McpServerNodeFormProps {
  config: McpServerNodeConfig;
  onChange: (config: McpServerNodeConfig) => void;
}

export function McpServerNodeForm({ config, onChange }: McpServerNodeFormProps) {
  const form = useForm({
    defaultValues: {
      serverId: config.serverId ?? '',
      toolName: config.toolName ?? '',
      argumentSource: config.argumentSource ?? 'from_state',
      staticArguments: config.staticArguments ? JSON.stringify(config.staticArguments, null, 2) : '',
      channelMappings: config.channelMappings ? JSON.stringify(config.channelMappings, null, 2) : '',
      outputChannel: config.outputChannel ?? 'mcp_result',
    } as McpFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      let staticArgs: Record<string, unknown> | undefined;
      if (value.argumentSource === 'static' && value.staticArguments) {
        try { staticArgs = JSON.parse(value.staticArguments); } catch { staticArgs = undefined; }
      }
      let mappings: Record<string, string> | undefined;
      if (value.argumentSource === 'from_state' && value.channelMappings) {
        try { mappings = JSON.parse(value.channelMappings); } catch { mappings = undefined; }
      }
      onChange({
        type: 'mcp_server',
        serverId: value.serverId,
        toolName: value.toolName,
        argumentSource: value.argumentSource,
        staticArguments: staticArgs,
        channelMappings: mappings,
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
      <form.Field name="serverId">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Server ID</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="mcp-server-id"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="toolName">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Tool Name</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="tool_name"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="argumentSource">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Argument Source</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                field.handleChange(v as McpFormValues['argumentSource']);
                handleBlur();
              }}
            >
              <SelectTrigger aria-label="Argument source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="from_state">From State Channels</SelectItem>
                <SelectItem value="static">Static Arguments</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <form.Field name="argumentSource">
        {(argField) =>
          argField.state.value === 'static' ? (
            <form.Field name="staticArguments">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Static Arguments (JSON)</Label>
                  <Textarea
                    id={field.name}
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={() => { field.handleBlur(); handleBlur(); }}
                    placeholder='{"key": "value"}'
                    rows={4}
                    className="font-mono text-xs"
                  />
                </div>
              )}
            </form.Field>
          ) : (
            <form.Field name="channelMappings">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Channel Mappings (JSON)</Label>
                  <Textarea
                    id={field.name}
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={() => { field.handleBlur(); handleBlur(); }}
                    placeholder='{"param": "channel_name"}'
                    rows={4}
                    className="font-mono text-xs"
                  />
                </div>
              )}
            </form.Field>
          )
        }
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
              placeholder="mcp_result"
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

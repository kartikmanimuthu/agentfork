'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CodeNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  language: z.enum(['javascript', 'typescript']),
  code: z.string().min(1, 'Code is required'),
  inputChannels: z.string(),
  outputChannel: z.string().min(1, 'Output channel is required'),
  timeoutMs: z.number().int().positive().optional(),
});

type CodeFormValues = z.infer<typeof schema>;

interface CodeNodeFormProps {
  config: CodeNodeConfig;
  onChange: (config: CodeNodeConfig) => void;
}

export function CodeNodeForm({ config, onChange }: CodeNodeFormProps) {
  const form = useForm({
    defaultValues: {
      language: config.language ?? 'javascript',
      code: config.code ?? '',
      inputChannels: (config.inputChannels ?? []).join(', '),
      outputChannel: config.outputChannel ?? 'result',
      timeoutMs: config.timeoutMs,
    } as CodeFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      onChange({
        type: 'code',
        language: value.language,
        code: value.code,
        inputChannels: value.inputChannels
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        outputChannel: value.outputChannel,
        timeoutMs: value.timeoutMs,
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
      <form.Field name="language">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Language</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                field.handleChange(v as CodeFormValues['language']);
                handleBlur();
              }}
            >
              <SelectTrigger aria-label="Language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="javascript">JavaScript</SelectItem>
                <SelectItem value="typescript">TypeScript</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <form.Field name="code">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Code</Label>
            <Textarea
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="return inputChannel * 2;"
              className="font-mono text-xs min-h-[120px]"
              rows={8}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="inputChannels">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Input Channels</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="channel1, channel2"
            />
            <p className="text-[10px] text-muted-foreground">Comma-separated channel names</p>
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
              placeholder="result"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="timeoutMs">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Timeout (ms)</Label>
            <Input
              id={field.name}
              type="number"
              min={1}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="5000"
            />
          </div>
        )}
      </form.Field>
    </form>
  );
}

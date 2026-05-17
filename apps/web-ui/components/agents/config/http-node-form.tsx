'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import type { HttpNodeConfig } from '@chatbot/agent-studio';

const schema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: z.string().min(1, 'URL is required'),
  bodyTemplate: z.string().optional(),
  bodyChannel: z.string().optional(),
  outputChannel: z.string().min(1, 'Output channel is required'),
  timeoutMs: z.number().int().positive().optional(),
});

type HttpFormValues = z.infer<typeof schema>;

interface HttpNodeFormProps {
  config: HttpNodeConfig;
  onChange: (config: HttpNodeConfig) => void;
}

export function HttpNodeForm({ config, onChange }: HttpNodeFormProps) {
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>(
    Object.entries(config.headers ?? {}).map(([key, value]) => ({ key, value }))
  );

  const form = useForm({
    defaultValues: {
      method: config.method ?? 'GET',
      url: config.url ?? '',
      bodyTemplate: config.bodyTemplate ?? '',
      bodyChannel: config.bodyChannel ?? '',
      outputChannel: config.outputChannel ?? 'http_response',
      timeoutMs: config.timeoutMs,
    } as HttpFormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      const headersRecord: Record<string, string> = {};
      for (const h of headers) {
        if (h.key.trim()) headersRecord[h.key.trim()] = h.value;
      }

      onChange({
        type: 'http',
        method: value.method,
        url: value.url,
        headers: Object.keys(headersRecord).length > 0 ? headersRecord : undefined,
        bodyTemplate: value.bodyTemplate || undefined,
        bodyChannel: value.bodyChannel || undefined,
        outputChannel: value.outputChannel,
        timeoutMs: value.timeoutMs,
      });
    },
  });

  const handleBlur = () => form.handleSubmit();

  const addHeader = () => setHeaders([...headers, { key: '', value: '' }]);
  const removeHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index));
    setTimeout(handleBlur, 0);
  };
  const updateHeader = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...headers];
    updated[index] = { ...updated[index], [field]: val };
    setHeaders(updated);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      <form.Field name="method">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Method</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                field.handleChange(v as HttpFormValues['method']);
                handleBlur();
              }}
            >
              <SelectTrigger aria-label="HTTP method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GET">GET</SelectItem>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
                <SelectItem value="PATCH">PATCH</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <form.Field name="url">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>URL</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="https://api.example.com/{{path}}"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label>Headers</Label>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={addHeader}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>
        {headers.map((header, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <Input
              value={header.key}
              onChange={(e) => updateHeader(i, 'key', e.target.value)}
              onBlur={handleBlur}
              placeholder="Key"
              className="flex-1 text-xs"
            />
            <Input
              value={header.value}
              onChange={(e) => updateHeader(i, 'value', e.target.value)}
              onBlur={handleBlur}
              placeholder="Value"
              className="flex-1 text-xs"
            />
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeHeader(i)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>

      <form.Field name="bodyTemplate">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Body Template</Label>
            <Textarea
              id={field.name}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder='{"query": "{{userInput}}"}'
              className="font-mono text-xs min-h-[80px]"
              rows={4}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="bodyChannel">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Body Channel</Label>
            <Input
              id={field.name}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => { field.handleBlur(); handleBlur(); }}
              placeholder="request_body"
            />
            <p className="text-[10px] text-muted-foreground">Overrides body template if set</p>
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
              placeholder="http_response"
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
              placeholder="10000"
            />
          </div>
        )}
      </form.Field>
    </form>
  );
}

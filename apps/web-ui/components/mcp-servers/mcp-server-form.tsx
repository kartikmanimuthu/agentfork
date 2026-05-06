'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useForm } from '@tanstack/react-form';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const transportSchema = z.discriminatedUnion('transport', [
  z.object({ transport: z.literal('sse'), endpoint: z.string().url(), headers: z.record(z.string()).optional() }),
  z.object({ transport: z.literal('stdio'), command: z.string().min(1), args: z.array(z.string()).optional(), env: z.record(z.string()).optional() }),
  z.object({ transport: z.literal('http_bridge'), bridgeUrl: z.string().url(), targetCommand: z.string().min(1) }),
]);

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().optional(),
  transport: z.enum(['sse', 'stdio', 'http_bridge']),
  transportConfig: transportSchema,
  timeoutMs: z.number().int().min(1000).max(300000).optional(),
  retryCount: z.number().int().min(0).max(10).optional(),
});

type FormValues = z.infer<typeof schema>;

interface McpServerFormProps {
  defaultValues?: Partial<FormValues>;
  onSubmit: (values: FormValues) => void;
  onTest?: () => void;
  loading?: boolean;
  testLoading?: boolean;
  submitLabel?: string;
}

export function McpServerForm({ defaultValues, onSubmit, onTest, loading, testLoading, submitLabel = 'Save' }: McpServerFormProps) {
  const [transport, setTransport] = useState<'sse' | 'stdio' | 'http_bridge'>(defaultValues?.transport ?? 'sse');

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? '',
      description: defaultValues?.description ?? '',
      transport: defaultValues?.transport ?? 'sse',
      transportConfig: defaultValues?.transportConfig ?? { transport: 'sse', endpoint: '' },
      timeoutMs: defaultValues?.timeoutMs ?? 30000,
      retryCount: defaultValues?.retryCount ?? 3,
    } as FormValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => onSubmit(value),
  });

  const handleTransportChange = (value: 'sse' | 'stdio' | 'http_bridge') => {
    setTransport(value);
    let newConfig;
    switch (value) {
      case 'sse': newConfig = { transport: 'sse', endpoint: '' }; break;
      case 'stdio': newConfig = { transport: 'stdio', command: '' }; break;
      case 'http_bridge': newConfig = { transport: 'http_bridge', bridgeUrl: '', targetCommand: '' }; break;
    }
    form.setFieldValue('transport', value);
    form.setFieldValue('transportConfig', newConfig as any);
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-6">
      <form.Field name="name">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Name</Label>
            <Input id={field.name} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="My MCP Server" />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="description">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={field.name}>Description</Label>
            <Textarea id={field.name} value={field.state.value ?? ''} onChange={(e) => field.handleChange(e.target.value)} placeholder="What does this MCP server do?" rows={3} />
          </div>
        )}
      </form.Field>

      <div className="grid gap-1.5">
        <Label>Transport Type</Label>
        <Select value={transport} onValueChange={handleTransportChange}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="sse">SSE (Server-Sent Events)</SelectItem>
            <SelectItem value="stdio">stdio (Local Process)</SelectItem>
            <SelectItem value="http_bridge">HTTP Bridge</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {transport === 'sse' && (
        <form.Field name="transportConfig">
          {(field) => {
            const config = (field.state.value ?? { endpoint: '' }) as { endpoint: string; headers?: Record<string, string> };
            return (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="grid gap-1.5">
                  <Label>Endpoint URL</Label>
                  <Input value={config.endpoint} onChange={(e) => field.handleChange({ ...config, transport: 'sse', endpoint: e.target.value })} placeholder="https://api.example.com/sse" />
                </div>
              </div>
            );
          }}
        </form.Field>
      )}

      {transport === 'stdio' && (
        <form.Field name="transportConfig">
          {(field) => {
            const config = (field.state.value ?? { command: '' }) as { command: string; args?: string[]; env?: Record<string, string> };
            return (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="grid gap-1.5">
                  <Label>Command</Label>
                  <Input value={config.command} onChange={(e) => field.handleChange({ ...config, transport: 'stdio', command: e.target.value })} placeholder="npx" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Arguments (comma-separated)</Label>
                  <Input value={(config.args ?? []).join(', ')} onChange={(e) => field.handleChange({ ...config, transport: 'stdio', args: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="-y, @modelcontextprotocol/server-filesystem" />
                </div>
              </div>
            );
          }}
        </form.Field>
      )}

      {transport === 'http_bridge' && (
        <form.Field name="transportConfig">
          {(field) => {
            const config = (field.state.value ?? { bridgeUrl: '', targetCommand: '' }) as { bridgeUrl: string; targetCommand: string };
            return (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="grid gap-1.5">
                  <Label>Bridge URL</Label>
                  <Input value={config.bridgeUrl} onChange={(e) => field.handleChange({ ...config, transport: 'http_bridge', bridgeUrl: e.target.value })} placeholder="https://bridge.example.com" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Target Command</Label>
                  <Input value={config.targetCommand} onChange={(e) => field.handleChange({ ...config, transport: 'http_bridge', targetCommand: e.target.value })} placeholder="npx @modelcontextprotocol/server-filesystem" />
                </div>
              </div>
            );
          }}
        </form.Field>
      )}

      <div className="grid grid-cols-2 gap-4">
        <form.Field name="timeoutMs">
          {(field) => (
            <div className="grid gap-1.5">
              <Label htmlFor={field.name}>Timeout (ms)</Label>
              <Input id={field.name} type="number" value={field.state.value ?? 30000} onChange={(e) => field.handleChange(Number(e.target.value))} min={1000} max={300000} />
            </div>
          )}
        </form.Field>
        <form.Field name="retryCount">
          {(field) => (
            <div className="grid gap-1.5">
              <Label htmlFor={field.name}>Retry Count</Label>
              <Input id={field.name} type="number" value={field.state.value ?? 3} onChange={(e) => field.handleChange(Number(e.target.value))} min={0} max={10} />
            </div>
          )}
        </form.Field>
      </div>

      <div className="flex gap-2">
        {onTest && <Button type="button" variant="outline" onClick={onTest} disabled={testLoading}>{testLoading ? 'Testing...' : 'Test Connection'}</Button>}
        <Button type="submit" disabled={loading}>{loading ? 'Saving...' : submitLabel}</Button>
      </div>
    </form>
  );
}

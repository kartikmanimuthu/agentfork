'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SecretInput } from '@/components/ui/secret-input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateMcpServer, useUpdateMcpServer, type McpServer } from '@/hooks/use-mcp-servers';

const schema = z
  .object({
    name: z.string().min(1, 'Name is required').max(100),
    description: z.string().optional(),
    transport: z.enum(['sse', 'stdio', 'http_bridge']),
    endpoint: z.string().optional(),
    bridgeUrl: z.string().optional(),
    bearerToken: z.string().optional(),
    command: z.string().optional(),
    args: z.string().optional(),
    targetCommand: z.string().optional(),
    timeoutMs: z.coerce.number().int().min(1000).max(300000),
    retryCount: z.coerce.number().int().min(0).max(10),
  })
  .superRefine((data, ctx) => {
    if (data.transport === 'sse' && !data.endpoint?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endpoint'], message: 'Endpoint URL is required' });
    }
    if (data.transport === 'http_bridge' && !data.bridgeUrl?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bridgeUrl'], message: 'Bridge URL is required' });
    }
    if (data.transport === 'stdio' && !data.command?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['command'], message: 'Command is required' });
    }
  });
type FormValues = z.infer<typeof schema>;

const DEFAULTS: FormValues = {
  name: '',
  description: '',
  transport: 'sse',
  endpoint: '',
  bridgeUrl: '',
  bearerToken: '',
  command: '',
  args: '',
  targetCommand: '',
  timeoutMs: 30000,
  retryCount: 3,
};

function serverToFormValues(server: McpServer): FormValues {
  const config = server.config as any;
  const transportConfig = config?.transportConfig ?? {};
  const headers = (transportConfig.headers ?? {}) as Record<string, string>;
  const bearerToken = headers.Authorization?.replace(/^Bearer\s+/, '') ?? '';
  return {
    name: server.name,
    description: server.description ?? '',
    transport: server.transport,
    endpoint: transportConfig.endpoint ?? '',
    bridgeUrl: transportConfig.bridgeUrl ?? '',
    bearerToken,
    command: transportConfig.command ?? '',
    args: Array.isArray(transportConfig.args) ? transportConfig.args.join(', ') : '',
    targetCommand: transportConfig.targetCommand ?? '',
    timeoutMs: config?.timeoutMs ?? 30000,
    retryCount: config?.retryCount ?? 3,
  };
}

function formValuesToConfig(values: FormValues) {
  const headers = values.bearerToken?.trim() ? { Authorization: `Bearer ${values.bearerToken.trim()}` } : undefined;
  const { timeoutMs, retryCount } = values;
  if (values.transport === 'sse') {
    return { transport: 'sse' as const, transportConfig: { transport: 'sse' as const, endpoint: values.endpoint!.trim(), headers }, timeoutMs, retryCount };
  }
  if (values.transport === 'http_bridge') {
    return {
      transport: 'http_bridge' as const,
      transportConfig: { transport: 'http_bridge' as const, bridgeUrl: values.bridgeUrl!.trim(), headers, targetCommand: values.targetCommand?.trim() || undefined },
      timeoutMs,
      retryCount,
    };
  }
  const args = values.args
    ? values.args.split(',').map((a) => a.trim()).filter(Boolean)
    : undefined;
  return { transport: 'stdio' as const, transportConfig: { transport: 'stdio' as const, command: values.command!.trim(), args }, timeoutMs, retryCount };
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  server?: McpServer | null;
}

export function McpServerFormDialog({ open, onOpenChange, server }: Props) {
  const createServer = useCreateMcpServer();
  const updateServer = useUpdateMcpServer(server?.id ?? '');
  const isEdit = !!server;

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: DEFAULTS });

  useEffect(() => {
    if (!open) return;
    form.reset(server ? serverToFormValues(server) : DEFAULTS);
  }, [open, server, form]);

  const transport = form.watch('transport');

  const onSubmit = async (values: FormValues) => {
    try {
      const config = formValuesToConfig(values);
      const input = { name: values.name, description: values.description || undefined, transport: values.transport, config };
      if (isEdit && server) {
        await updateServer.mutateAsync(input as any);
        toast.success('MCP server updated', { description: values.name });
      } else {
        await createServer.mutateAsync(input as any);
        toast.success('MCP server created', { description: values.name });
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(isEdit ? 'Update failed' : 'Create failed', { description: e instanceof Error ? e.message : 'Please try again' });
    }
  };

  const submitting = createServer.isPending || updateServer.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit MCP Server' : 'Create MCP Server'}</DialogTitle>
          <DialogDescription>Registered servers are shared across this tenant — Claw automatically uses every active one.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="Grafana" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea rows={2} placeholder="What does this MCP server do?" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="transport" render={({ field }) => (
              <FormItem><FormLabel>Transport</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="sse">SSE (Server-Sent Events)</SelectItem>
                    <SelectItem value="stdio">stdio (Local Process)</SelectItem>
                    <SelectItem value="http_bridge">HTTP Bridge</SelectItem>
                  </SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />

            {transport === 'sse' && (
              <>
                <FormField control={form.control} name="endpoint" render={({ field }) => (
                  <FormItem><FormLabel>Endpoint URL</FormLabel><FormControl><Input placeholder="https://api.example.com/sse" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="bearerToken" render={({ field }) => (
                  <FormItem><FormLabel>Bearer Token <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl><SecretInput placeholder="your-api-token" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground">Sent as <code>Authorization: Bearer &lt;token&gt;</code></p>
                  </FormItem>
                )} />
              </>
            )}

            {transport === 'stdio' && (
              <>
                <FormField control={form.control} name="command" render={({ field }) => (
                  <FormItem><FormLabel>Command</FormLabel><FormControl><Input placeholder="npx" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="args" render={({ field }) => (
                  <FormItem><FormLabel>Arguments (comma-separated)</FormLabel><FormControl><Input placeholder="-y, @modelcontextprotocol/server-filesystem" {...field} /></FormControl></FormItem>
                )} />
                <p className="text-xs text-muted-foreground">stdio servers cannot be connected to yet — the shared MCP client only supports SSE and HTTP Bridge at runtime.</p>
              </>
            )}

            {transport === 'http_bridge' && (
              <>
                <FormField control={form.control} name="bridgeUrl" render={({ field }) => (
                  <FormItem><FormLabel>Bridge URL</FormLabel><FormControl><Input placeholder="https://bridge.example.com" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="bearerToken" render={({ field }) => (
                  <FormItem><FormLabel>Bearer Token <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl><SecretInput placeholder="your-api-token" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground">Sent as <code>Authorization: Bearer &lt;token&gt;</code></p>
                  </FormItem>
                )} />
                <FormField control={form.control} name="targetCommand" render={({ field }) => (
                  <FormItem><FormLabel>Target Command <span className="text-muted-foreground font-normal">(optional)</span></FormLabel><FormControl><Input placeholder="npx @modelcontextprotocol/server-filesystem" {...field} /></FormControl></FormItem>
                )} />
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="timeoutMs" render={({ field }) => (
                <FormItem><FormLabel>Timeout (ms)</FormLabel><FormControl><Input type="number" min={1000} max={300000} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="retryCount" render={({ field }) => (
                <FormItem><FormLabel>Retry Count</FormLabel><FormControl><Input type="number" min={0} max={10} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create server'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

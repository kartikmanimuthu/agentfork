'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCreateMcpServer } from '@/hooks/use-mcp-servers';
import { McpServerForm } from '@/components/mcp-servers/mcp-server-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

export default function NewMcpServerPage() {
  const router = useRouter();
  const createMutation = useCreateMcpServer();

  const handleSubmit = async (values: {
    name: string;
    description?: string;
    transport: 'sse' | 'stdio' | 'http_bridge';
    transportConfig: Record<string, unknown>;
    timeoutMs?: number;
    retryCount?: number;
  }) => {
    const { name, description, transport, transportConfig, timeoutMs, retryCount } = values;
    const payload = {
      name,
      description,
      transport,
      config: {
        ...transportConfig,
        timeoutMs,
        retryCount,
      },
    };

    try {
      await createMutation.mutateAsync(payload);
      toast.success('MCP server created');
      router.push('/mcp-servers');
    } catch {
      toast.error('Failed to create MCP server');
    }
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          render={<Link href="/mcp-servers" aria-label="Back to MCP servers" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">New MCP Server</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Server Details</CardTitle>
          <CardDescription>Configure the transport and connection settings for your MCP server.</CardDescription>
        </CardHeader>
        <CardContent>
          <McpServerForm onSubmit={handleSubmit} loading={createMutation.isPending} submitLabel="Create Server" />
        </CardContent>
      </Card>
    </div>
  );
}

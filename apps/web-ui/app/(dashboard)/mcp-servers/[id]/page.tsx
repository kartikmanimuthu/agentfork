'use client';

import { useParams, useRouter } from 'next/navigation';
import { useMcpServer, useUpdateMcpServer, useTestMcpServer } from '@/hooks/use-mcp-servers';
import { McpServerForm } from '@/components/mcp-servers/mcp-server-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Server, History } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

export default function McpServerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const serverId = params.id;

  const { data: server, isLoading } = useMcpServer(serverId);
  const updateMutation = useUpdateMcpServer(serverId);
  const testMutation = useTestMcpServer(serverId);

  if (isLoading) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 max-w-2xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!server) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <p className="text-muted-foreground">MCP server not found.</p>
          <Button variant="outline" onClick={() => router.push('/mcp-servers')}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back to Servers
          </Button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (values: {
    name: string;
    description?: string;
    transport: 'sse' | 'stdio' | 'http_bridge';
    transportConfig: Record<string, unknown>;
    timeoutMs?: number;
    retryCount?: number;
  }) => {
    try {
      await updateMutation.mutateAsync({
        name: values.name,
        description: values.description,
        transport: values.transport,
        config: {
          transport: values.transport,
          transportConfig: values.transportConfig,
          timeoutMs: values.timeoutMs,
          retryCount: values.retryCount,
        },
      });
      toast.success('MCP server updated');
    } catch {
      toast.error('Failed to update MCP server');
    }
  };

  const handleTest = async () => {
    try {
      const result = await testMutation.mutateAsync();
      if (result.connected) {
        toast.success('Connection successful');
      } else {
        toast.error(result.error ?? 'Connection failed');
      }
    } catch {
      toast.error('Test failed');
    }
  };

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 bg-background max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push('/mcp-servers')}><ArrowLeft className="h-4 w-4" /></Button>
        <Server className="h-5 w-5" />
        <h2 className="text-2xl font-bold tracking-tight">{server.name}</h2>
        <Badge variant="outline" className="capitalize">{server.transport}</Badge>
        <Link href={`/mcp-servers/${serverId}/versions`} className="ml-auto">
          <Button variant="ghost" size="sm"><History className="h-4 w-4 mr-1" />Versions</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>Update the transport settings and connection parameters.</CardDescription>
        </CardHeader>
        <CardContent>
          <McpServerForm
            defaultValues={{
              name: server.name,
              description: server.description ?? undefined,
              transport: server.transport,
              transportConfig: (server.config as any)?.transportConfig ?? {
                transport: server.transport,
                ...(server.transport === 'sse' && { endpoint: '' }),
                ...(server.transport === 'stdio' && { command: '' }),
                ...(server.transport === 'http_bridge' && { bridgeUrl: '', targetCommand: '' }),
              },
              timeoutMs: (server.config as any)?.timeoutMs ?? 30000,
              retryCount: (server.config as any)?.retryCount ?? 3,
            }}
            onSubmit={handleSubmit}
            onTest={handleTest}
            loading={updateMutation.isPending}
            testLoading={testMutation.isPending}
            submitLabel="Save Changes"
          />
        </CardContent>
      </Card>
    </div>
  );
}

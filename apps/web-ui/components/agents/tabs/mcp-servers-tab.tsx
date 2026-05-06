'use client';

import { useMcpServers, useAgentMcpServers, useAttachMcpServer, useDetachMcpServer } from '@/hooks/use-mcp-servers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Server, Plus, Minus } from 'lucide-react';

interface McpServersTabProps {
  agentId: string;
}

export function McpServersTab({ agentId }: McpServersTabProps) {
  const { data: allServers, isLoading: allLoading } = useMcpServers({ pageSize: 100 });
  const { data: attachedServers, isLoading: attachedLoading } = useAgentMcpServers(agentId);
  const attachMutation = useAttachMcpServer(agentId);
  const detachMutation = useDetachMcpServer(agentId);

  const isLoading = allLoading || attachedLoading;
  const attachedIds = new Set((attachedServers ?? []).map((s) => s.id));

  const handleAttach = async (serverId: string) => {
    try {
      await attachMutation.mutateAsync(serverId);
      toast.success('MCP server attached');
    } catch {
      toast.error('Failed to attach MCP server');
    }
  };

  const handleDetach = async (serverId: string) => {
    try {
      await detachMutation.mutateAsync(serverId);
      toast.success('MCP server detached');
    } catch {
      toast.error('Failed to detach MCP server');
    }
  };

  const getTransportLabel = (t: string) => {
    switch (t) {
      case 'sse': return 'SSE';
      case 'stdio': return 'stdio';
      case 'http_bridge': return 'Bridge';
      default: return t;
    }
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'active': return 'default' as const;
      case 'inactive': return 'secondary' as const;
      case 'error': return 'destructive' as const;
      default: return 'outline' as const;
    }
  };

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  }

  const servers = allServers?.items ?? [];

  if (servers.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No MCP servers available. <a href="/mcp-servers" className="underline">Create one first</a>.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Attached MCP Servers</CardTitle>
          <CardDescription>{attachedServers?.length ?? 0} server{(attachedServers?.length ?? 0) !== 1 ? 's' : ''} attached</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {servers.map((server) => {
              const isAttached = attachedIds.has(server.id);
              return (
                <div key={server.id} className="flex items-center justify-between rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    <Server className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{server.name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">{getTransportLabel(server.transport)}</Badge>
                        <Badge variant={getStatusVariant(server.status)} className="text-xs capitalize">{server.status}</Badge>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant={isAttached ? 'outline' : 'default'}
                    size="sm"
                    onClick={() => isAttached ? handleDetach(server.id) : handleAttach(server.id)}
                    disabled={attachMutation.isPending || detachMutation.isPending}
                  >
                    {isAttached ? <><Minus className="h-4 w-4 mr-1" />Remove</> : <><Plus className="h-4 w-4 mr-1" />Add</>}
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

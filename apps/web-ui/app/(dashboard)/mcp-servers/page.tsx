'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useMcpServers, useDeleteMcpServer } from '@/hooks/use-mcp-servers';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Plus, Search, Server, Settings, Trash2, History } from 'lucide-react';

export default function McpServersPage() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useMcpServers({ search, pageSize: 50 });
  const deleteMutation = useDeleteMcpServer();

  const servers = useMemo(() => data?.items ?? [], [data]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this MCP server? It will be detached from all agents.')) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('MCP server deleted');
    } catch {
      toast.error('Failed to delete MCP server');
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

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center gap-2">
        <Server className="h-6 w-6" />
        <h2 className="text-3xl font-bold tracking-tight">MCP Servers</h2>
      </div>
      <p className="text-muted-foreground">Manage Model Context Protocol servers for your agents.</p>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>All Servers</CardTitle>
              <CardDescription>
                {isLoading ? <Skeleton className="h-4 w-32" /> : `${servers.length} server${servers.length !== 1 ? 's' : ''}`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search servers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              </div>
              <Link href="/mcp-servers/new" className={buttonVariants()}>
                <Plus className="h-4 w-4 mr-2" />New Server
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : servers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No MCP servers yet. Create one to get started.</div>
          ) : (
            <div className="space-y-2">
              {servers.map((server) => (
                <div key={server.id} className="flex items-center justify-between rounded-lg border p-4 hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <Server className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium">{server.name}</div>
                      {server.description && <div className="text-sm text-muted-foreground truncate max-w-md">{server.description}</div>}
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">{getTransportLabel(server.transport)}</Badge>
                        <Badge variant={getStatusVariant(server.status)} className="text-xs capitalize">{server.status}</Badge>
                        <span className="text-xs text-muted-foreground">{server._count?.versions ?? 0} version{(server._count?.versions ?? 0) !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Link href={`/mcp-servers/${server.id}/versions`} className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'h-8 w-8' })} aria-label="Versions"><History className="h-4 w-4" /></Link>
                    <Link href={`/mcp-servers/${server.id}`} className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'h-8 w-8' })} aria-label="Settings"><Settings className="h-4 w-4" /></Link>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(server.id)} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

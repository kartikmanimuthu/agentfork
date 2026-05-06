'use client';

import { useParams, useRouter } from 'next/navigation';
import { useMcpServer, useMcpServerVersions, useRestoreMcpServerVersion } from '@/hooks/use-mcp-servers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Server, RotateCcw, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';

interface McpServerVersionItem {
  id: string;
  version: number;
  config: Record<string, unknown>;
  changeNotes: string | null;
  createdBy: string;
  createdAt: string;
}

export default function McpServerVersionsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const serverId = params.id;

  const { data: server, isLoading: serverLoading } = useMcpServer(serverId);
  const { data: versions, isLoading: versionsLoading } = useMcpServerVersions(serverId);
  const restoreMutation = useRestoreMcpServerVersion(serverId);
  const [previewVersion, setPreviewVersion] = useState<McpServerVersionItem | null>(null);

  const isLoading = serverLoading || versionsLoading;

  if (isLoading) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 max-w-3xl mx-auto">
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
          <Button variant="outline" onClick={() => router.push('/mcp-servers')}><ArrowLeft className="h-4 w-4 mr-2" />Back to Servers</Button>
        </div>
      </div>
    );
  }

  const handleRestore = async (versionId: string) => {
    if (!confirm('Restore this version? A new version snapshot will be created.')) return;
    try {
      await restoreMutation.mutateAsync(versionId);
      toast.success('Version restored');
    } catch {
      toast.error('Failed to restore version');
    }
  };

  const versionList = (versions ?? []) as McpServerVersionItem[];

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 bg-background max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push(`/mcp-servers/${serverId}`)}><ArrowLeft className="h-4 w-4" /></Button>
        <Server className="h-5 w-5" />
        <h2 className="text-2xl font-bold tracking-tight">{server.name}</h2>
        <Badge variant="outline">Version History</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Versions</CardTitle>
          <CardDescription>{versionList.length} version{versionList.length !== 1 ? 's' : ''} saved</CardDescription>
        </CardHeader>
        <CardContent>
          {versionList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No versions yet. Edit the server to create snapshots.</div>
          ) : (
            <div className="space-y-2">
              {versionList.map((version) => (
                <div key={version.id} className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <div className="font-medium">Version {version.version}</div>
                    <div className="text-sm text-muted-foreground">{new Date(version.createdAt).toLocaleString()} · {version.createdBy}</div>
                    {version.changeNotes && <div className="text-sm text-muted-foreground mt-1">{version.changeNotes}</div>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPreviewVersion(version)}><Eye className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRestore(version.id)} disabled={restoreMutation.isPending}><RotateCcw className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {previewVersion && (
        <Card>
          <CardHeader><CardTitle>Version {previewVersion.version} Preview</CardTitle></CardHeader>
          <CardContent>
            <pre className="rounded-lg bg-muted p-4 overflow-auto text-sm">{JSON.stringify(previewVersion.config, null, 2)}</pre>
            <Button variant="outline" className="mt-4" onClick={() => setPreviewVersion(null)}>Close Preview</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

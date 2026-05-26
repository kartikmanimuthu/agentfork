'use client';

import { useAgentVersions, usePublishAgent } from '@/hooks/use-agent-versions';
import { useAgentAliases } from '@/hooks/use-agent-aliases';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Play, CheckCircle } from 'lucide-react';
import Link from 'next/link';

export function VersionsTab({ agentId }: { agentId: string }) {
  const { data: versions, isLoading } = useAgentVersions(agentId);
  const { data: aliases } = useAgentAliases(agentId);
  const publish = usePublishAgent(agentId);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Versions</CardTitle>
        <CardDescription>View version history, publish versions, and test in playground.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {versions?.length === 0 && (
          <p className="text-muted-foreground text-sm">No versions yet. Save the agent to create one.</p>
        )}
        {versions?.map((v) => {
          const versionAliases = aliases?.filter((a) => a.versionId === v.id) ?? [];
          return (
            <div key={v.id} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                  {v.version}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">Version {v.version}</p>
                    <Badge variant={v.status === 'published' ? 'default' : v.status === 'draft' ? 'secondary' : 'outline'} className="text-[10px]">
                      {v.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {versionAliases.length > 0
                      ? `Aliases: ${versionAliases.map((a) => `${a.name}${a.isDefault ? ' (default)' : ''}`).join(', ')}`
                      : 'No aliases'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link href={`/agents/${agentId}/playground?version=version:${v.id}`}>
                      <Play className="h-3 w-3 mr-1" />
                      Test
                    </Link>
                  }
                />
                {v.status === 'draft' && (
                  <Button
                    size="sm"
                    onClick={() => publish.mutateAsync(v.id).then(() => toast.success('Published')).catch(() => toast.error('Failed'))}
                    disabled={publish.isPending}
                  >
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Publish
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

'use client';

import { useAgentKnowledgeBases, useAttachKnowledgeBase, useDetachKnowledgeBase } from '@/hooks/use-agent-knowledge-bases';
import { useKnowledgeBases } from '@/hooks/use-knowledge-bases';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { BookOpen, Link2, Unlink } from 'lucide-react';

export function KnowledgeBasesTab({ agentId }: { agentId: string }) {
  const { data: attached, isLoading: attachedLoading } = useAgentKnowledgeBases(agentId);
  const { data: allKBs, isLoading: allLoading } = useKnowledgeBases();
  const attach = useAttachKnowledgeBase(agentId);
  const detach = useDetachKnowledgeBase(agentId);

  const attachedIds = new Set((attached ?? []).map((a) => a.knowledgeBaseId));

  if (attachedLoading || allLoading) {
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
        <CardTitle>Knowledge Bases</CardTitle>
        <CardDescription>Attach knowledge bases to provide context for this agent.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {allKBs?.items.length === 0 && (
          <p className="text-muted-foreground text-sm">No knowledge bases available. Create one first.</p>
        )}
        {allKBs?.items.map((kb) => {
          const isAttached = attachedIds.has(kb.id);
          return (
            <div key={kb.id} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <BookOpen className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">{kb.name}</p>
                  <p className="text-xs text-muted-foreground">{kb.documentCount} documents · {kb.chunkCount} chunks</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={kb.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">{kb.status}</Badge>
                {isAttached ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => detach.mutateAsync(kb.id).then(() => toast.success('Detached')).catch(() => toast.error('Failed'))}
                    disabled={detach.isPending}
                  >
                    <Unlink className="h-3 w-3 mr-1" />
                    Detach
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => attach.mutateAsync(kb.id).then(() => toast.success('Attached')).catch(() => toast.error('Failed'))}
                    disabled={attach.isPending}
                  >
                    <Link2 className="h-3 w-3 mr-1" />
                    Attach
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

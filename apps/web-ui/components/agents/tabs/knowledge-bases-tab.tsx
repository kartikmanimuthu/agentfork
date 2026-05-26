'use client';

import { useAgentKnowledgeBases, useAttachKnowledgeBase, useDetachKnowledgeBase } from '@/hooks/use-agent-knowledge-bases';
import { useKnowledgeBases } from '@/hooks/use-knowledge-bases';
import { useCreateAgentVersion } from '@/hooks/use-agent-versions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { BookOpen, Link2, Unlink } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useState } from 'react';

export function KnowledgeBasesTab({ agentId, agentConfig }: { agentId: string; agentConfig: Record<string, unknown> }) {
  const { data: attached, isLoading: attachedLoading } = useAgentKnowledgeBases(agentId);
  const { data: allKBs, isLoading: allLoading } = useKnowledgeBases();
  const attach = useAttachKnowledgeBase(agentId);
  const detach = useDetachKnowledgeBase(agentId);
  const createVersion = useCreateAgentVersion(agentId);

  const [detachTarget, setDetachTarget] = useState<string | null>(null);

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
                    onClick={() => setDetachTarget(kb.id)}
                    disabled={detach.isPending}
                  >
                    <Unlink className="h-3 w-3 mr-1" />
                    Detach
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => attach.mutateAsync(kb.id).then(() => createVersion.mutateAsync(agentConfig)).then(() => toast.success('Knowledge base attached')).catch(() => toast.error('Failed to attach knowledge base'))}
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
      <AlertDialog open={!!detachTarget} onOpenChange={(open) => !open && setDetachTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Detach knowledge base?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the knowledge base from this agent. The knowledge base itself will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDetachTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (detachTarget) {
                  detach.mutateAsync(detachTarget).then(() => createVersion.mutateAsync(agentConfig)).then(() => toast.success('Knowledge base detached')).catch(() => toast.error('Failed to detach knowledge base'));
                }
                setDetachTarget(null);
              }}
            >
              Detach
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

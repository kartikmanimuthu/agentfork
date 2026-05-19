'use client';

import { useState } from 'react';
import { useAgentVersions, usePublishAgent, type AgentVersion } from '@/hooks/use-agent-versions';
import { AliasManager } from '../tabs/alias-manager';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Upload, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface VersionsPanelProps {
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoadVersion: (version: AgentVersion) => void;
  isDirty: boolean;
}

export function VersionsPanel({
  agentId,
  open,
  onOpenChange,
  onLoadVersion,
  isDirty,
}: VersionsPanelProps) {
  const { data: versions, isLoading } = useAgentVersions(agentId);
  const publish = usePublishAgent(agentId);
  const [loadTarget, setLoadTarget] = useState<AgentVersion | null>(null);

  const handleLoad = (version: AgentVersion) => {
    if (isDirty) {
      setLoadTarget(version);
    } else {
      onLoadVersion(version);
    }
  };

  const confirmLoad = () => {
    if (loadTarget) {
      onLoadVersion(loadTarget);
      setLoadTarget(null);
    }
  };

  const handlePublish = async (versionId: string) => {
    try {
      await publish.mutateAsync(versionId);
      toast.success('Version published');
    } catch {
      toast.error('Failed to publish');
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Versions & Aliases</SheetTitle>
            <SheetDescription>Manage version history and deployment aliases.</SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 px-4">
            <div className="space-y-3 pb-4">
              <h4 className="text-sm font-medium">Version History</h4>

              {isLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {versions?.length === 0 && !isLoading && (
                <p className="text-sm text-muted-foreground">No versions yet.</p>
              )}

              {versions?.map((v) => (
                <div key={v.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">v{v.version}</span>
                      <Badge
                        variant={v.status === 'published' ? 'default' : 'outline'}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {v.status}
                      </Badge>
                      {v.aliases?.map((a) => (
                        <Badge key={a.id} variant="secondary" className="text-[10px] px-1.5 py-0">
                          {a.name}
                        </Badge>
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(v.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleLoad(v)}
                      aria-label={`Load version ${v.version}`}
                    >
                      <Download className="h-3.5 w-3.5 mr-1" />
                      Load
                    </Button>
                    {v.status === 'draft' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handlePublish(v.id)}
                        disabled={publish.isPending}
                        aria-label={`Publish version ${v.version}`}
                      >
                        <Upload className="h-3.5 w-3.5 mr-1" />
                        Publish
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <Separator className="my-4" />

            <div className="pb-6">
              <AliasManager agentId={agentId} />
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!loadTarget} onOpenChange={(open) => !open && setLoadTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes on the canvas. Loading a previous version will discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLoad}>
              Discard & Load
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

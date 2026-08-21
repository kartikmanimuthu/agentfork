'use client';

import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  useRestoreWorkspaceRevision, useWorkspaceRevisions,
} from '@/hooks/use-workspace-files';

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

export function RevisionHistoryDialog({
  slug,
  open,
  onOpenChange,
}: {
  slug: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const { data, isLoading } = useWorkspaceRevisions(open ? slug : null);
  const restore = useRestoreWorkspaceRevision();

  const onRestore = async (version: number) => {
    if (!slug) return;
    try {
      const file = await restore.mutateAsync({ slug, version });
      toast.success('Restored', { description: `${slug} is now v${file.version}` });
      onOpenChange(false);
    } catch (error) {
      toast.error('Restore failed', {
        description: error instanceof Error ? error.message : 'Try again',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>History — {slug}</DialogTitle>
          <DialogDescription>
            Every edit, by you or by Claw. Restoring writes the old content back as a new version.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">No revisions yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>When</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((revision) => (
                <TableRow key={revision.version} data-testid="revision-row">
                  <TableCell>v{revision.version}</TableCell>
                  <TableCell>
                    {revision.updatedBy === 'claw'
                      ? <Badge variant="secondary">Claw</Badge>
                      : <span className="text-muted-foreground">You</span>}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{revision.reason ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDateTime(revision.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={restore.isPending}
                      onClick={() => onRestore(revision.version)}
                      data-testid="revision-restore"
                    >
                      Restore
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

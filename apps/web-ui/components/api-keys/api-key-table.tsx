'use client';

import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { ApiKeyItem } from '@/hooks/use-api-keys';
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
import { Code2 } from 'lucide-react';
import { ApiGuideDialog } from '@/components/api-keys/api-guide-dialog';

interface ApiKeyTableProps {
  keys: ApiKeyItem[];
  loading: boolean;
  onRevoke: (keyId: string) => void;
}

export function ApiKeyTable({ keys, loading, onRevoke }: ApiKeyTableProps) {
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading API keys...</div>;
  }

  if (keys.length === 0) {
    return <div className="text-sm text-muted-foreground">No API keys found. Create one to get started.</div>;
  }

  return (
    <>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Key</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Daily Limit</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((key) => (
          <TableRow key={key.id}>
            <TableCell className="font-medium">{key.name}</TableCell>
            <TableCell className="font-mono text-xs">{key.keyPrefix}...</TableCell>
            <TableCell>
              <Badge variant={key.status === 'active' ? 'default' : 'secondary'}>
                {key.status}
              </Badge>
            </TableCell>
            <TableCell className="text-sm">
              {key.dailyReqLimit} req / {key.dailyTokenLimit} tokens
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {new Date(key.createdAt).toLocaleDateString()}
            </TableCell>
            <TableCell className="text-right">
              {key.status === 'active' && (
                <div className="flex items-center justify-end gap-2">
                  <ApiGuideDialog
                    keyName={key.name}
                    rawKey={key.rawKey}
                    trigger={
                      <Button variant="ghost" size="sm" aria-label="View integration guide">
                        <Code2 className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRevokeTarget(key.id)}
                  >
                    Revoke
                  </Button>
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
          <AlertDialogDescription>
            This API key will be permanently revoked and cannot be used again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setRevokeTarget(null)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              if (revokeTarget) onRevoke(revokeTarget);
              setRevokeTarget(null);
            }}
          >
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

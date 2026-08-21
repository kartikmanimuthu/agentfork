'use client';

import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

interface ConnectorResetCardProps {
  displayName: string;
  /** Human-readable list of what gets wiped, e.g. "bot token and secret token". */
  clears: string;
  disabled?: boolean;
  pending?: boolean;
  onReset: () => void;
}

export function ConnectorResetCard({
  displayName,
  clears,
  disabled,
  pending,
  onReset,
}: ConnectorResetCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base">Reset connector</CardTitle>
        <CardDescription>
          Removes the stored {clears} for {displayName}. You&apos;ll need to enter them again to reconnect.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" disabled={disabled || pending} onClick={() => setOpen(true)}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
          Reset {displayName}
        </Button>
      </CardContent>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset {displayName} connector?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the stored {clears}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOpen(false);
                onReset();
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

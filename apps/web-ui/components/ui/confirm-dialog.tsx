'use client';

import * as React from 'react';
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
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Confirmation for destructive actions, replacing `window.confirm`.
 *
 * Several delete handlers gated on `confirm('Delete this MCP server? …')`. That
 * dialog is unstyled and unbranded, it cannot be dismissed with the app's own
 * focus handling, its wording is truncated by some browsers, and it blocks the
 * main thread — but the real problem is that it gives the destructive choice the
 * SAME visual weight as the safe one, with "OK" as the default. Here the
 * destructive action is styled as destructive and Cancel keeps initial focus.
 *
 * Deliberately not a hook or a global: `AlertDialog` traps focus and restores it
 * to the trigger on close, which only works when the dialog is rendered by the
 * component that owns the trigger.
 */
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. Default true — this exists for deletes. */
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false);

  const handleConfirm = async (event: React.MouseEvent) => {
    // Held open while the mutation runs so a slow delete cannot be double-fired
    // by an impatient second click — the old confirm() closed instantly and left
    // the button live underneath.
    event.preventDefault();
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={busy}
            className={cn(destructive && buttonVariants({ variant: 'destructive' }))}
          >
            {busy ? 'Working…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

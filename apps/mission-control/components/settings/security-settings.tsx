'use client';

import { useState } from 'react';
import { Check, Copy, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useResetStudioPassword } from '@/hooks/use-studio-profile';

export function SecuritySettings() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const reset = useResetStudioPassword();

  const handleReset = async () => {
    try {
      const result = await reset.mutateAsync();
      setConfirmOpen(false);
      setNewPassword(result.password);
    } catch (e) {
      toast.error('Failed to reset password', { description: e instanceof Error ? e.message : undefined });
    }
  };

  const handleCopy = async () => {
    if (!newPassword) return;
    await navigator.clipboard.writeText(newPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Reset your Studio login password.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                <Label>Studio password</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Generates a brand new password and signs out every other session using this Studio.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
              Reset Password
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Studio password?</AlertDialogTitle>
            <AlertDialogDescription>
              This immediately invalidates the current password. A new one will be shown once — make sure you're
              ready to save it before continuing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleReset()} disabled={reset.isPending}>
              {reset.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Reset Password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!newPassword} onOpenChange={(open) => !open && setNewPassword(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your new password</DialogTitle>
            <DialogDescription>
              This is shown only once and cannot be recovered later — copy it somewhere safe now.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={newPassword ?? ''} className="font-mono" />
            <Button variant="outline" size="icon" onClick={() => void handleCopy()} aria-label="Copy password">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

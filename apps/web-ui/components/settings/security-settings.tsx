'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Shield, KeyRound, Smartphone, LogOut } from 'lucide-react';

const changePasswordFormSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Confirm password is required'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type ChangePasswordFormValues = z.infer<typeof changePasswordFormSchema>;

function ChangePasswordDialog() {
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    } as ChangePasswordFormValues,
    validators: {
      onChange: changePasswordFormSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        const res = await fetch('/api/user/password', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentPassword: value.currentPassword,
            newPassword: value.newPassword,
            confirmPassword: value.confirmPassword,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Failed to change password' }));
          toast.error(err.error || 'Failed to change password');
          return;
        }

        toast.success('Password changed successfully');
        form.reset();
        setOpen(false);
      } catch {
        toast.error('Failed to change password');
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button variant="outline" size="sm">
          Change Password
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
          <DialogDescription>
            Enter your current password and a new password below.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-4 pt-2"
        >
          <form.Field
            name="currentPassword"
            children={(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Current Password</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="password"
                  placeholder="Enter current password"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={!field.state.meta.isValid}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">
                    {field.state.meta.errors
                      .map((e) => (typeof e === 'string' ? e : (e as any)?.message ?? String(e)))
                      .join(', ')}
                  </p>
                )}
              </div>
            )}
          />
          <form.Field
            name="newPassword"
            children={(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>New Password</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="password"
                  placeholder="Enter new password"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={!field.state.meta.isValid}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">
                    {field.state.meta.errors
                      .map((e) => (typeof e === 'string' ? e : (e as any)?.message ?? String(e)))
                      .join(', ')}
                  </p>
                )}
              </div>
            )}
          />
          <form.Field
            name="confirmPassword"
            children={(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Confirm New Password</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="password"
                  placeholder="Confirm new password"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={!field.state.meta.isValid}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">
                    {field.state.meta.errors
                      .map((e) => (typeof e === 'string' ? e : (e as any)?.message ?? String(e)))
                      .join(', ')}
                  </p>
                )}
              </div>
            )}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                form.reset();
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <form.Subscribe
              selector={(state) => [state.canSubmit, state.isSubmitting]}
              children={([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? 'Updating...' : 'Update Password'}
                </Button>
              )}
            />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SecuritySettings() {
  const [twoFactor, setTwoFactor] = useState(false);
  const [sessionAlerts, setSessionAlerts] = useState(true);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Authentication</CardTitle>
          <CardDescription>Manage how you sign in to your account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                <Label>Password</Label>
              </div>
              <p className="text-sm text-muted-foreground">Last changed 3 months ago.</p>
            </div>
            <ChangePasswordDialog />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-muted-foreground" />
                <Label>Two-Factor Authentication</Label>
              </div>
              <p className="text-sm text-muted-foreground">Add an extra layer of security.</p>
            </div>
            <Switch checked={twoFactor} onCheckedChange={setTwoFactor} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>Manage your active sessions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Current Session</p>
              <p className="text-sm text-muted-foreground">Started on this device just now.</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-xs text-muted-foreground">Active</span>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Session Alerts</Label>
              <p className="text-sm text-muted-foreground">Get notified of new sign-ins.</p>
            </div>
            <Switch checked={sessionAlerts} onCheckedChange={setSessionAlerts} />
          </div>

          <div className="pt-2">
            <Button variant="destructive" size="sm" onClick={() => toast.info('Sign out all sessions coming soon')}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out All Sessions
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

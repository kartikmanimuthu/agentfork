'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useForm } from '@tanstack/react-form';
import * as z from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Building2, ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

interface TenantSettings {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  timezone: string;
  notifications: {
    scheduleExecutions: boolean;
    memberInvites: boolean;
    systemAlerts: boolean;
  };
}

const orgFormSchema = z.object({
  name: z.string().min(1, 'Organization name is required.'),
  timezone: z.string(),
  scheduleExecutions: z.boolean(),
  memberInvites: z.boolean(),
  systemAlerts: z.boolean(),
});

type OrgFormValues = z.infer<typeof orgFormSchema>;

const TIMEZONES = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [
      'UTC',
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Toronto',
      'America/Sao_Paulo',
      'Europe/London',
      'Europe/Paris',
      'Europe/Berlin',
      'Europe/Moscow',
      'Asia/Dubai',
      'Asia/Kolkata',
      'Asia/Shanghai',
      'Asia/Singapore',
      'Asia/Tokyo',
      'Asia/Seoul',
      'Australia/Sydney',
      'Pacific/Auckland',
      'Africa/Johannesburg',
    ];
  }
})();

export default function OrganizationSettingsPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const role = user?.role as string | undefined;
  const canEdit = role === 'Owner' || role === 'Admin';

  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const form = useForm({
    defaultValues: {
      name: '',
      timezone: 'UTC',
      scheduleExecutions: true,
      memberInvites: true,
      systemAlerts: true,
    } as OrgFormValues,
    validators: {
      onChange: orgFormSchema,
    },
    onSubmit: async ({ value }) => {
      if (!canEdit) return;
      try {
        const res = await fetch('/api/tenants/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: value.name.trim(),
            timezone: value.timezone,
            notifications: {
              scheduleExecutions: value.scheduleExecutions,
              memberInvites: value.memberInvites,
              systemAlerts: value.systemAlerts,
            },
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          toast.error(err.error || 'Failed to save settings');
          return;
        }
        const updated: TenantSettings = await res.json();
        setSettings(updated);
        form.reset({
          name: updated.name,
          timezone: updated.timezone,
          scheduleExecutions: updated.notifications.scheduleExecutions,
          memberInvites: updated.notifications.memberInvites,
          systemAlerts: updated.notifications.systemAlerts,
        });
        toast.success('Organization settings saved');
      } catch {
        toast.error('Failed to save settings');
      }
    },
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    setLoading(true);
    try {
      const res = await fetch('/api/tenants/settings');
      if (!res.ok) {
        toast.error('Failed to load organization settings');
        return;
      }
      const data: TenantSettings = await res.json();
      setSettings(data);
      form.reset({
        name: data.name,
        timezone: data.timezone,
        scheduleExecutions: data.notifications.scheduleExecutions,
        memberInvites: data.notifications.memberInvites,
        systemAlerts: data.notifications.systemAlerts,
      });
    } catch {
      toast.error('Failed to load organization settings');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 space-y-4">
      <div className="flex items-center space-x-2">
        <Building2 className="h-6 w-6" />
        <h2 className="text-3xl font-bold tracking-tight">Organization</h2>
      </div>
      <p className="text-muted-foreground">Manage your organization details and preferences.</p>

      <div className="max-w-2xl space-y-4">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="space-y-4"
          >
            <Card>
              <CardHeader>
                <CardTitle>Organization Details</CardTitle>
                <CardDescription>Update your organization name and view identifiers.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form.Field
                  name="name"
                  children={(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Organization Name</Label>
                      <Input
                        id={field.name}
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        disabled={!canEdit}
                        aria-invalid={!field.state.meta.isValid}
                      />
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-sm text-destructive">{field.state.meta.errors.join(', ')}</p>
                      )}
                    </div>
                  )}
                />

                <div className="space-y-2">
                  <Label htmlFor="org-slug">Slug</Label>
                  <Input id="org-slug" value={settings?.slug ?? '—'} disabled />
                  <p className="text-xs text-muted-foreground">Used in URLs. Contact support to change.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tenant-id">Tenant ID</Label>
                  <Input id="tenant-id" value={settings?.id ?? '—'} disabled />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Preferences</CardTitle>
                <CardDescription>Set timezone and notification preferences for your organization.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form.Field
                  name="timezone"
                  children={(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Timezone</Label>
                      <Select
                        value={field.state.value}
                        onValueChange={(value) => field.handleChange(value)}
                        disabled={!canEdit}
                      >
                        <SelectTrigger id={field.name} className="w-full">
                          <SelectValue placeholder="Select timezone" />
                        </SelectTrigger>
                        <SelectContent className="max-h-60">
                          {TIMEZONES.map((tz) => (
                            <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                />

                <div className="space-y-3 pt-2">
                  <p className="text-sm font-medium">Notifications</p>

                  <form.Field
                    name="scheduleExecutions"
                    children={(field) => (
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-sm">Schedule Executions</label>
                          <p className="text-xs text-muted-foreground">Alerts when scheduled jobs run.</p>
                        </div>
                        <Switch
                          checked={field.state.value}
                          onCheckedChange={(checked) => field.handleChange(checked)}
                          disabled={!canEdit}
                        />
                      </div>
                    )}
                  />

                  <form.Field
                    name="memberInvites"
                    children={(field) => (
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-sm">Member Invites</label>
                          <p className="text-xs text-muted-foreground">Alerts when members are invited or removed.</p>
                        </div>
                        <Switch
                          checked={field.state.value}
                          onCheckedChange={(checked) => field.handleChange(checked)}
                          disabled={!canEdit}
                        />
                      </div>
                    )}
                  />

                  <form.Field
                    name="systemAlerts"
                    children={(field) => (
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-sm">System Alerts</label>
                          <p className="text-xs text-muted-foreground">Critical system and security alerts.</p>
                        </div>
                        <Switch
                          checked={field.state.value}
                          onCheckedChange={(checked) => field.handleChange(checked)}
                          disabled={!canEdit}
                        />
                      </div>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center gap-3">
              <form.Subscribe
                selector={(state) => [state.isDirty, state.isSubmitting]}
                children={([isDirty, isSubmitting]) => (
                  <Button type="submit" disabled={!canEdit || !isDirty || isSubmitting}>
                    <Save className="mr-2 h-4 w-4" />
                    {isSubmitting ? 'Saving...' : 'Save Changes'}
                  </Button>
                )}
              />
              <Link href="/settings">
                <Button variant="outline">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Settings
                </Button>
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

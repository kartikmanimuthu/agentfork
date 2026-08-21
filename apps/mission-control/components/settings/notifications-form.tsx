'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useStudioNotifications, useSaveStudioNotifications, type NotificationPrefs } from '@/hooks/use-studio-notifications';

const FIELDS: Array<{ key: keyof NotificationPrefs; label: string; description: string }> = [
  {
    key: 'scheduledTaskFailures',
    label: 'Scheduled task failures',
    description: 'Notify me when a scheduled Claw run fails.',
  },
  {
    key: 'approvalRequests',
    label: 'Approval requests',
    description: 'Notify me when Claw is waiting on an approval.',
  },
  {
    key: 'weeklySummary',
    label: 'Weekly summary',
    description: 'Send a weekly summary of Claw activity.',
  },
];

export function NotificationsForm() {
  const { data, isLoading } = useStudioNotifications();
  const save = useSaveStudioNotifications();
  const [values, setValues] = useState<NotificationPrefs | null>(null);

  useEffect(() => {
    if (data) setValues(data);
  }, [data]);

  if (isLoading || !values) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const dirty = data ? JSON.stringify(data) !== JSON.stringify(values) : false;

  const handleSave = async () => {
    try {
      await save.mutateAsync(values);
      toast.success('Notification preferences saved');
    } catch (e) {
      toast.error('Failed to save preferences', { description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="space-y-4">
      {FIELDS.map((field, i) => (
        <div key={field.key}>
          {i > 0 ? <Separator className="mb-4" /> : null}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor={field.key}>{field.label}</Label>
              <p className="text-sm text-muted-foreground">{field.description}</p>
            </div>
            <Switch
              id={field.key}
              checked={values[field.key]}
              onCheckedChange={(checked) => setValues({ ...values, [field.key]: checked })}
            />
          </div>
        </div>
      ))}

      <div className="pt-2">
        <Button onClick={handleSave} disabled={!dirty || save.isPending}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {save.isPending ? 'Saving...' : 'Save Preferences'}
        </Button>
      </div>
    </div>
  );
}

'use client';

import { useForm } from '@tanstack/react-form';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Save } from 'lucide-react';

interface NotificationsFormProps {
  defaultValues?: {
    emailNotifications: boolean;
    pushNotifications: boolean;
    marketingEmails: boolean;
    conversationUpdates: boolean;
    securityAlerts: boolean;
  };
}

export function NotificationsForm({ defaultValues }: NotificationsFormProps) {
  const form = useForm({
    defaultValues: {
      emailNotifications: defaultValues?.emailNotifications ?? true,
      pushNotifications: defaultValues?.pushNotifications ?? true,
      marketingEmails: defaultValues?.marketingEmails ?? false,
      conversationUpdates: defaultValues?.conversationUpdates ?? true,
      securityAlerts: defaultValues?.securityAlerts ?? true,
    },
    onSubmit: async ({ value }) => {
      try {
        const res = await fetch('/api/users/notifications', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        });
        if (res.ok) {
          toast.success('Notification preferences saved');
        } else {
          toast.error('Failed to save preferences');
        }
      } catch {
        toast.success('Notification preferences saved');
      }
    },
  });

  const switches = [
    {
      name: 'emailNotifications' as const,
      label: 'Email Notifications',
      description: 'Receive updates via email.',
    },
    {
      name: 'pushNotifications' as const,
      label: 'Push Notifications',
      description: 'Receive push notifications in browser.',
    },
    {
      name: 'conversationUpdates' as const,
      label: 'Conversation Updates',
      description: 'Get notified when conversations are updated.',
    },
    {
      name: 'securityAlerts' as const,
      label: 'Security Alerts',
      description: 'Receive important security notifications.',
    },
    {
      name: 'marketingEmails' as const,
      label: 'Marketing Emails',
      description: 'Receive product updates and offers.',
    },
  ];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      {switches.map((item, index) => (
        <div key={item.name}>
          {index > 0 && <Separator className="mb-4" />}
          <form.Field
            name={item.name}
            children={(field) => (
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor={item.name}>{item.label}</Label>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
                <Switch
                  id={item.name}
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                />
              </div>
            )}
          />
        </div>
      ))}

      <div className="pt-2">
        <form.Subscribe
          selector={(state) => [state.isDirty, state.isSubmitting]}
          children={([isDirty, isSubmitting]) => (
            <Button type="submit" disabled={!isDirty || isSubmitting}>
              <Save className="mr-2 h-4 w-4" />
              {isSubmitting ? 'Saving...' : 'Save Preferences'}
            </Button>
          )}
        />
      </div>
    </form>
  );
}

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
    systemAlerts: boolean;
  };
  llmConfig: {
    provider: 'bedrock' | 'openai';
    chatModel?: string;
    baseUrl?: string;
    apiKey?: string;
  } | null;
}

const orgFormSchema = z.object({
  name: z.string().min(1, 'Organization name is required.'),
  timezone: z.string(),
  systemAlerts: z.boolean(),
  llmProvider: z.enum(['bedrock', 'openai']),
  llmChatModel: z.string().optional(),
  llmBaseUrl: z.string().optional(),
  llmApiKey: z.string().optional(),
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
  const { data: session, update } = useSession();
  const user = session?.user as any;
  const role = user?.role as string | undefined;
  const canEdit = role === 'Owner' || role === 'Admin';

  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const form = useForm({
    defaultValues: {
      name: '',
      timezone: 'UTC',
      systemAlerts: true,
      llmProvider: 'bedrock',
      llmChatModel: '',
      llmBaseUrl: '',
      llmApiKey: '',
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
              systemAlerts: value.systemAlerts,
            },
            llmConfig: {
              provider: value.llmProvider,
              chatModel: value.llmChatModel || undefined,
              baseUrl: value.llmBaseUrl || undefined,
              apiKey: value.llmApiKey && value.llmApiKey !== '••••••' ? value.llmApiKey : undefined,
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
        form.setFieldValue('name', updated.name);
        form.setFieldValue('timezone', updated.timezone);
        form.setFieldValue('systemAlerts', updated.notifications.systemAlerts);
        await update();
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
      form.setFieldValue('name', data.name);
      form.setFieldValue('timezone', data.timezone);
      form.setFieldValue('systemAlerts', data.notifications.systemAlerts);
      const llm = data.llmConfig;
      form.setFieldValue('llmProvider', llm?.provider ?? 'bedrock');
      form.setFieldValue('llmChatModel', llm?.chatModel ?? '');
      form.setFieldValue('llmBaseUrl', llm?.baseUrl ?? '');
      form.setFieldValue('llmApiKey', llm?.apiKey ? '••••••' : '');
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
                        <p className="text-sm text-destructive">
                          {field.state.meta.errors
                            .map((e) => (typeof e === 'string' ? e : (e as any)?.message ?? String(e)))
                            .join(', ')}
                        </p>
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
                <CardTitle>AI Provider</CardTitle>
                <CardDescription>Configure the LLM provider used for chat inference in your organization.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form.Field
                  name="llmProvider"
                  children={(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Provider</Label>
                      <Select
                        value={field.state.value}
                        onValueChange={(value) => {
                          field.handleChange(value as 'bedrock' | 'openai');
                          if (value === 'bedrock') {
                            form.setFieldValue('llmBaseUrl', '');
                            form.setFieldValue('llmApiKey', '');
                          }
                        }}
                        disabled={!canEdit}
                      >
                        <SelectTrigger id={field.name} className="w-full">
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bedrock">Amazon Bedrock</SelectItem>
                          <SelectItem value="openai">OpenAI Compatible (Ollama, vLLM, etc.)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                />

                <form.Subscribe
                  selector={(state) => state.values.llmProvider}
                  children={(provider) => (
                    <>
                      <form.Field
                        name="llmChatModel"
                        children={(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Chat Model</Label>
                            <Input
                              id={field.name}
                              name={field.name}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => field.handleChange(e.target.value)}
                              disabled={!canEdit}
                              placeholder={provider === 'bedrock' ? 'anthropic.claude-sonnet-4-20250514' : 'gpt-4o'}
                            />
                            <p className="text-xs text-muted-foreground">
                              {provider === 'bedrock'
                                ? 'Bedrock model ID (e.g., anthropic.claude-sonnet-4-20250514)'
                                : 'Model name exposed by the OpenAI-compatible endpoint'}
                            </p>
                          </div>
                        )}
                      />

                      {provider === 'openai' && (
                        <>
                          <form.Field
                            name="llmBaseUrl"
                            children={(field) => (
                              <div className="space-y-2">
                                <Label htmlFor={field.name}>Base URL</Label>
                                <Input
                                  id={field.name}
                                  name={field.name}
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={(e) => field.handleChange(e.target.value)}
                                  disabled={!canEdit}
                                  placeholder="http://localhost:11434/v1"
                                />
                                <p className="text-xs text-muted-foreground">
                                  OpenAI-compatible API base URL (e.g., Ollama: http://localhost:11434/v1)
                                </p>
                              </div>
                            )}
                          />

                          <form.Field
                            name="llmApiKey"
                            children={(field) => (
                              <div className="space-y-2">
                                <Label htmlFor={field.name}>API Key</Label>
                                <Input
                                  id={field.name}
                                  name={field.name}
                                  type="password"
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={(e) => field.handleChange(e.target.value)}
                                  disabled={!canEdit}
                                  placeholder={field.state.value === '••••••' ? '••••••' : 'Optional for local endpoints'}
                                />
                                <p className="text-xs text-muted-foreground">
                                  Leave blank to keep existing key. Not required for local endpoints like Ollama.
                                </p>
                              </div>
                            )}
                          />
                        </>
                      )}
                    </>
                  )}
                />
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

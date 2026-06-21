'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { BUILT_IN_TOOLS, BUILT_IN_TOOL_NAMES } from '@/components/agents/config/built-in-tools';
import { useWebSearchConfig, useSaveWebSearchConfig } from '@/hooks/use-tenant-config';
import type { WebSearchConfig } from '@/hooks/use-tenant-config';
import type { SimpleAgentConfig } from '@chatbot/agent-studio';

interface ToolsTabProps {
  config: SimpleAgentConfig;
  onSave: (config: SimpleAgentConfig) => Promise<void>;
  saving?: boolean;
}

const DEFAULT_PROVIDER_FORM: WebSearchConfig = {
  provider: 'tavily',
  apiKey: '',
  apiBase: '',
  maxResults: 10,
};

export function ToolsTab({ config, onSave, saving }: ToolsTabProps) {
  const initialTools = config.tools ?? [];
  const [enabledBuiltIns, setEnabledBuiltIns] = useState<string[]>(
    initialTools.filter((t) => BUILT_IN_TOOL_NAMES.includes(t)),
  );

  const webSearchEnabled = enabledBuiltIns.includes('web_search');

  const toggleBuiltIn = (name: string, enabled: boolean) => {
    setEnabledBuiltIns((prev) =>
      enabled ? [...new Set([...prev, name])] : prev.filter((t) => t !== name),
    );
  };

  const handleSaveTools = async () => {
    const nonBuiltInTools = (config.tools ?? []).filter((t) => !BUILT_IN_TOOL_NAMES.includes(t));
    await onSave({ ...config, tools: [...nonBuiltInTools, ...enabledBuiltIns] });
  };

  // ─── Provider sub-form ────────────────────────────────────────────────────
  const { data: savedConfig, isLoading: configLoading } = useWebSearchConfig();
  const saveMutation = useSaveWebSearchConfig();
  const [providerForm, setProviderForm] = useState<WebSearchConfig>(DEFAULT_PROVIDER_FORM);

  useEffect(() => {
    if (savedConfig) {
      setProviderForm({
        provider: savedConfig.provider ?? 'tavily',
        apiKey: savedConfig.apiKey ?? '',
        apiBase: savedConfig.apiBase ?? '',
        maxResults: savedConfig.maxResults ?? 10,
      });
    }
  }, [savedConfig]);

  const handleSaveProvider = async () => {
    try {
      const payload: WebSearchConfig = {
        provider: providerForm.provider,
        maxResults: providerForm.maxResults,
      };
      if (providerForm.provider === 'searxng') {
        payload.apiBase = providerForm.apiBase;
      } else {
        payload.apiKey = providerForm.apiKey;
      }
      await saveMutation.mutateAsync(payload);
      toast.success('Search provider saved');
    } catch {
      toast.error('Failed to save search provider');
    }
  };

  const providerConfigured =
    savedConfig &&
    (savedConfig.provider === 'searxng' ? !!savedConfig.apiBase : !!savedConfig.apiKey);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Built-in Tools</CardTitle>
        <CardDescription>Native tools this agent can call during a conversation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* ── Web Search toggle + sub-form ─────────────────────────────────── */}
        <div className="rounded-md border">
          <div className="flex items-center justify-between gap-4 p-3">
            <div className="grid gap-0.5">
              <Label htmlFor="builtin-web_search" className="cursor-pointer">
                Web Search
              </Label>
              <p className="text-xs text-muted-foreground">
                Search the web for current information (requires a configured search provider).
              </p>
            </div>
            <Switch
              id="builtin-web_search"
              checked={webSearchEnabled}
              onCheckedChange={(v) => toggleBuiltIn('web_search', v)}
            />
          </div>

          {webSearchEnabled && (
            <>
              <Separator />
              <div className="p-4 space-y-4 bg-muted/30 rounded-b-md">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Search Provider Configuration
                </p>

                {configLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                ) : (
                  <>
                    {!providerConfigured && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-2">
                        Web Search is enabled but no provider is configured. Set up a provider below so the agent can perform searches.
                      </p>
                    )}

                    <div className="grid gap-1.5">
                      <Label>Provider</Label>
                      <Select
                        value={providerForm.provider}
                        onValueChange={(v) =>
                          setProviderForm((f) => ({
                            ...f,
                            provider: v as WebSearchConfig['provider'],
                            apiKey: '',
                            apiBase: '',
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a provider" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tavily">Tavily</SelectItem>
                          <SelectItem value="brave">Brave Search</SelectItem>
                          <SelectItem value="searxng">SearXNG (self-hosted)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {providerForm.provider === 'searxng' ? (
                      <div className="grid gap-1.5">
                        <Label htmlFor="searxng-base">API Base URL</Label>
                        <Input
                          id="searxng-base"
                          type="url"
                          placeholder="https://searxng.example.com"
                          value={providerForm.apiBase ?? ''}
                          onChange={(e) =>
                            setProviderForm((f) => ({ ...f, apiBase: e.target.value }))
                          }
                        />
                      </div>
                    ) : (
                      <div className="grid gap-1.5">
                        <Label htmlFor="provider-api-key">API Key</Label>
                        <Input
                          id="provider-api-key"
                          type="password"
                          placeholder={providerForm.provider === 'tavily' ? 'tvly-...' : 'BSA...'}
                          value={providerForm.apiKey ?? ''}
                          onChange={(e) =>
                            setProviderForm((f) => ({ ...f, apiKey: e.target.value }))
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          {providerForm.provider === 'tavily'
                            ? 'Free tier available at tavily.com'
                            : 'Available at brave.com/search/api'}
                        </p>
                      </div>
                    )}

                    <div className="grid gap-1.5">
                      <Label htmlFor="max-results">Max Results</Label>
                      <Input
                        id="max-results"
                        type="number"
                        min={1}
                        max={50}
                        value={providerForm.maxResults ?? 10}
                        onChange={(e) =>
                          setProviderForm((f) => ({
                            ...f,
                            maxResults: Number(e.target.value) || 10,
                          }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Maximum results per query (1–50). Credentials are shared across all agents in your organization.
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSaveProvider}
                      disabled={saveMutation.isPending}
                      className="w-full"
                    >
                      {saveMutation.isPending ? 'Saving...' : 'Save Provider'}
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Other built-in tools ─────────────────────────────────────────── */}
        {BUILT_IN_TOOLS.filter((t) => t.name !== 'web_search').map((tool) => {
          const checked = enabledBuiltIns.includes(tool.name);
          return (
            <div
              key={tool.name}
              className="flex items-center justify-between gap-4 rounded-md border p-3"
            >
              <div className="grid gap-0.5">
                <Label htmlFor={`builtin-${tool.name}`} className="cursor-pointer">
                  {tool.label}
                </Label>
                <p className="text-xs text-muted-foreground">{tool.description}</p>
              </div>
              <Switch
                id={`builtin-${tool.name}`}
                checked={checked}
                onCheckedChange={(v) => toggleBuiltIn(tool.name, v)}
              />
            </div>
          );
        })}

        <Button onClick={handleSaveTools} disabled={saving} className="w-full">
          {saving ? 'Saving...' : 'Save Tools'}
        </Button>
      </CardContent>
    </Card>
  );
}

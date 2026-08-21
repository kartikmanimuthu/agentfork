'use client';

import * as React from 'react';
import { SearchIcon } from 'lucide-react';
import { useLlmProviders, type LlmProvider } from '@/hooks/use-llm-providers';
import {
  Combobox,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxLabel,
} from '@/components/ui/combobox';
import { Skeleton } from '@/components/ui/skeleton';

export type ModelCapability = 'chat' | 'embedding';

interface DiscoveredModel {
  id: string;
  name: string;
  capabilities: string[];
}

interface ProviderModelSelectProps {
  capability: ModelCapability;
  value?: string;
  /** providerId is which provider's entry was actually clicked — undefined for a typed/custom ID. */
  onChange: (value: string, providerId?: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

function getModelsForCapability(
  provider: LlmProvider,
  capability: ModelCapability
): DiscoveredModel[] {
  const discovered = (provider.models as { models?: DiscoveredModel[] } | null)?.models ?? [];
  const filtered = discovered.filter((m) => m.capabilities.includes(capability));
  if (filtered.length > 0) return filtered;

  const fallbackModel = capability === 'chat' ? provider.chatModel : provider.embeddingModel;
  if (fallbackModel) return [{ id: fallbackModel, name: fallbackModel, capabilities: [capability] }];
  return [];
}

export function ProviderModelSelect({
  capability,
  value,
  onChange,
  placeholder = 'Select a model',
  disabled,
}: ProviderModelSelectProps) {
  const { data: providers, isLoading } = useLlmProviders();
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const searchRef = React.useRef<HTMLInputElement>(null);
  // Prevents double-commit when a list item is clicked or Enter already handled
  const skipCommitRef = React.useRef(false);
  // Two different providers can expose the identical model id — this remembers which
  // provider's entry was actually clicked, so only that one shows checked (otherwise every
  // provider offering the same model id would all show as selected).
  const [explicitProviderId, setExplicitProviderId] = React.useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-10 w-full" />;

  if (!providers || providers.length === 0) {
    return (
      <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
        No LLM providers configured
      </div>
    );
  }

  const grouped = providers
    .map((provider) => ({ provider, models: getModelsForCapability(provider, capability) }))
    .filter((g) => g.models.length > 0);

  if (grouped.length === 0) {
    return (
      <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
        No {capability} models available from configured providers
      </div>
    );
  }

  const allModels = grouped.flatMap(({ provider, models }) =>
    models.map((m) => ({ ...m, providerName: provider.name, providerId: provider.id }))
  );

  // Prefer the explicitly-clicked provider if it still offers this model id; otherwise
  // fall back to the first provider that does (e.g. on initial load from a saved value).
  const matchesForValue = allModels.filter((m) => m.id === value);
  const selectedModel =
    (explicitProviderId && matchesForValue.find((m) => m.providerId === explicitProviderId)) ||
    matchesForValue[0];
  const isCustom = !!value && !selectedModel;
  const selectedCompoundKey = selectedModel ? `${selectedModel.providerId}::${selectedModel.id}` : '';

  const query = searchQuery.toLowerCase();
  const filteredGrouped = grouped
    .map(({ provider, models }) => ({
      provider,
      models: query
        ? models.filter((m) => m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query))
        : models,
    }))
    .filter((g) => g.models.length > 0);

  const hasMatches = filteredGrouped.length > 0;

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      // Pre-fill search with custom ID so user can edit it
      if (isCustom && value) setSearchQuery(value);
      setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      // Commit typed value as custom ID if nothing was selected from the list
      if (!skipCommitRef.current && searchQuery.trim() && !hasMatches) {
        onChange(searchQuery.trim());
      }
      skipCommitRef.current = false;
      setSearchQuery('');
    }
    setOpen(nextOpen);
  }

  function handleValueChange(compoundKey: string | null) {
    // A list item was clicked — skip the commit-on-close logic
    skipCommitRef.current = true;
    if (!compoundKey) {
      setExplicitProviderId(null);
      onChange('');
      return;
    }
    const sep = compoundKey.indexOf('::');
    const providerId = compoundKey.slice(0, sep);
    const modelId = compoundKey.slice(sep + 2);
    setExplicitProviderId(providerId);
    onChange(modelId, providerId);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && searchQuery.trim() && !hasMatches) {
      e.preventDefault();
      skipCommitRef.current = true;
      onChange(searchQuery.trim());
      setOpen(false);
      setSearchQuery('');
    }
    if (e.key === 'Escape') {
      skipCommitRef.current = true;
      setOpen(false);
      setSearchQuery('');
    }
  }

  return (
    <Combobox
      value={selectedCompoundKey}
      onValueChange={handleValueChange}
      open={open}
      onOpenChange={handleOpenChange}
      disabled={disabled}
    >
      <ComboboxTrigger className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
        {selectedModel ? (
          <span>{selectedModel.name}</span>
        ) : isCustom ? (
          <span className="flex items-center gap-2">
            <span className="truncate font-mono text-xs">{value}</span>
            <span className="shrink-0 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-400">
              custom
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </ComboboxTrigger>

      <ComboboxContent>
        {/* Plain controlled input — ComboboxInput (base-ui) doesn't filter when inside the popup */}
        <div className="m-1 mb-0 flex h-8 items-center gap-1.5 rounded-md border border-input/30 bg-input/30 px-2">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search or enter a model ID…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <ComboboxList style={{ scrollbarWidth: 'thin', maxHeight: '16rem' }}>
          {hasMatches ? (
            filteredGrouped.map(({ provider, models }) => (
              <ComboboxGroup key={provider.id}>
                <ComboboxLabel>{provider.name}</ComboboxLabel>
                {models.map((model) => (
                  <ComboboxItem key={`${provider.id}::${model.id}`} value={`${provider.id}::${model.id}`}>
                    {model.name}
                  </ComboboxItem>
                ))}
              </ComboboxGroup>
            ))
          ) : (
            <div className="px-3 py-4 text-center">
              <p className="text-sm text-muted-foreground">No discovered models match</p>
              {searchQuery.trim() && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Press <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">Enter</kbd> or click away to use this ID
                </p>
              )}
            </div>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

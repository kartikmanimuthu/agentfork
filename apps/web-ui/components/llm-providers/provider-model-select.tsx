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
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

function getModelsForCapability(
  provider: LlmProvider,
  capability: ModelCapability
): DiscoveredModel[] {
  const discovered = (provider.models as { models?: DiscoveredModel[] } | null)?.models ?? [];
  const filtered = discovered.filter((m) => m.capabilities.includes(capability));
  if (filtered.length > 0) {
    return filtered;
  }

  const fallbackModel = capability === 'chat' ? provider.chatModel : provider.embeddingModel;
  if (fallbackModel) {
    return [{ id: fallbackModel, name: fallbackModel, capabilities: [capability] }];
  }

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
  const [searchQuery, setSearchQuery] = React.useState('');
  const searchRef = React.useRef<HTMLInputElement>(null);

  if (isLoading) {
    return <Skeleton className="h-10 w-full" />;
  }

  if (!providers || providers.length === 0) {
    return (
      <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
        No LLM providers configured
      </div>
    );
  }

  const grouped = providers
    .map((provider) => ({
      provider,
      models: getModelsForCapability(provider, capability),
    }))
    .filter((group) => group.models.length > 0);

  if (grouped.length === 0) {
    return (
      <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
        No {capability} models available from configured providers
      </div>
    );
  }

  const allModels = grouped.flatMap(({ provider, models }) =>
    models.map((model) => ({ ...model, providerName: provider.name, providerId: provider.id }))
  );

  const selectedModel = allModels.find((m) => m.id === value);

  const query = searchQuery.toLowerCase();
  const filteredGrouped = grouped
    .map(({ provider, models }) => ({
      provider,
      models: query
        ? models.filter(
            (m) =>
              m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query)
          )
        : models,
    }))
    .filter((g) => g.models.length > 0);

  function handleOpenChange(open: boolean) {
    if (open) {
      // Focus search after popup animation
      setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      setSearchQuery('');
    }
  }

  function handleValueChange(v: string | null) {
    onChange(v ?? '');
    setSearchQuery('');
  }

  return (
    <Combobox
      value={value ?? ''}
      onValueChange={handleValueChange}
      onOpenChange={handleOpenChange}
      disabled={disabled}
    >
      <ComboboxTrigger className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
        <span className={selectedModel ? '' : 'text-muted-foreground'}>
          {selectedModel?.name ?? placeholder}
        </span>
      </ComboboxTrigger>
      <ComboboxContent>
        {/* Plain controlled input — ComboboxInput (base-ui) doesn't filter when inside the popup */}
        <div className="m-1 mb-0 flex h-8 items-center gap-1.5 rounded-md border border-input/30 bg-input/30 px-2">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ComboboxList style={{ scrollbarWidth: 'thin', maxHeight: '16rem' }}>
          {filteredGrouped.length === 0 ? (
            <div className="py-2 text-center text-sm text-muted-foreground">No models found</div>
          ) : (
            filteredGrouped.map(({ provider, models }) => (
              <ComboboxGroup key={provider.id}>
                <ComboboxLabel>{provider.name}</ComboboxLabel>
                {models.map((model) => (
                  <ComboboxItem key={`${provider.id}::${model.id}`} value={model.id}>
                    {model.name}
                  </ComboboxItem>
                ))}
              </ComboboxGroup>
            ))
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

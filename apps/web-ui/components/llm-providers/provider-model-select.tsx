'use client';

import * as React from 'react';
import { useLlmProviders, type LlmProvider } from '@/hooks/use-llm-providers';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxEmpty,
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
    models.map((model) => ({
      ...model,
      providerName: provider.name,
      providerId: provider.id,
    }))
  );

  const selectedModel = allModels.find((m) => m.id === value);

  return (
    <Combobox
      value={value ?? ''}
      onValueChange={onChange}
      disabled={disabled}
    >
      <ComboboxInput
        placeholder={selectedModel?.name ?? placeholder}
        showClear={!!value}
        disabled={disabled}
      />
      <ComboboxContent>
        <ComboboxList>
          <ComboboxEmpty>No models found</ComboboxEmpty>
          {grouped.map(({ provider, models }) => (
            <ComboboxGroup key={provider.id}>
              <ComboboxLabel>{provider.name}</ComboboxLabel>
              {models.map((model) => (
                <ComboboxItem key={`${provider.id}::${model.id}`} value={model.id}>
                  {model.name}
                </ComboboxItem>
              ))}
            </ComboboxGroup>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

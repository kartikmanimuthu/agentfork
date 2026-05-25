'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { useLlmProviders, type LlmProvider } from '@/hooks/use-llm-providers';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from '@/components/ui/select';
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
  // Try discovered models JSON first
  const discovered = (provider.models as { models?: DiscoveredModel[] } | null)?.models ?? [];
  const filtered = discovered.filter((m) => m.capabilities.includes(capability));
  if (filtered.length > 0) {
    return filtered;
  }

  // Fallback to the provider's configured default model
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

  // Use compound "providerId::modelId" as the Select value to ensure uniqueness
  // across providers that may expose the same model ID.
  const compoundValue =
    grouped
      .flatMap(({ provider, models }) =>
        models.map((m) => ({ compound: `${provider.id}::${m.id}`, modelId: m.id }))
      )
      .find(({ modelId }) => modelId === value)?.compound ?? '';

  return (
    <Select
      value={compoundValue}
      onValueChange={(v) => onChange(v.split('::').slice(1).join('::'))}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {grouped.map(({ provider, models }) => (
          <SelectGroup key={provider.id}>
            <SelectPrimitive.Label className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
              {provider.name}
            </SelectPrimitive.Label>
            {models.map((model) => (
              <SelectItem key={`${provider.id}::${model.id}`} value={`${provider.id}::${model.id}`}>
                {model.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

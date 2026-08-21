'use client';

import { Cpu } from 'lucide-react';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useLlmProviders } from '@/hooks/use-llm-providers';

/**
 * Model switcher for the chat header.
 *
 * Lists MODELS, grouped by the provider that serves them — not one row per
 * provider. A provider is a set of credentials and an endpoint, not a single
 * model: the self-hosted LiteLLM gateway fronts the whole llm-powerhouse fleet
 * (gpt-oss-20b, nemotron-lightning, muse-glimmer-30b, qwen-3-6, bonsai-27b …)
 * behind one row, and `LlmProvider.models` already holds that list from model
 * discovery. Showing providers meant the eight self-hosted models collapsed
 * into a single "self hosted" entry with no way to reach the other seven.
 *
 * The value encodes both halves as `<providerId>::<modelId>`, because the
 * runtime needs the provider (for credentials and endpoint) AND the model.
 * Selecting one persists both — see /api/chat's provider + settings.chatModel
 * write.
 */
const SENTINEL = '__default__';
const SEP = '::';

export function encodeValue(providerId: string, modelId: string | null): string {
  return modelId ? `${providerId}${SEP}${modelId}` : providerId;
}

export function decodeValue(value: string): { providerModelId: string; chatModel: string | null } | null {
  if (!value || value === SENTINEL) return null;
  const at = value.indexOf(SEP);
  if (at === -1) return { providerModelId: value, chatModel: null };
  return { providerModelId: value.slice(0, at), chatModel: value.slice(at + SEP.length) };
}

interface ProviderModel {
  id?: string;
  name?: string;
  capabilities?: string[];
}

/**
 * Chat-capable models only.
 *
 * `LlmProvider.models` is `unknown` on the DTO — a free-form Json column filled
 * by model discovery, and it mixes capabilities: the Bedrock providers list 18
 * embedding models alongside the chat ones. Offering `amazon.titan-embed-text-v2:0`
 * as something to converse with would hand the agent a model that cannot hold a
 * conversation at all. Entries with no capabilities recorded are kept, since
 * older discovery runs did not populate the field and dropping them silently
 * would empty the list.
 */
function modelsOf(raw: unknown): ProviderModel[] {
  const list = (raw as { models?: unknown } | null)?.models;
  if (!Array.isArray(list)) return [];
  return (list as ProviderModel[]).filter(
    (m) => !Array.isArray(m?.capabilities) || m.capabilities.includes('chat'),
  );
}

export function ModelPicker({
  providerModelId,
  chatModel,
  fallbackProviderModelId = null,
  fallbackChatModel = null,
  onChange,
  disabled,
}: {
  providerModelId: string | null;
  chatModel: string | null;
  /**
   * Shown when the Claw has no pin of its own — the tenant's default provider,
   * which is what the runtime already resolves to (claw-runtime.ts:273). Display
   * only: it is deliberately NOT fed back through `onChange`, so no pin is
   * written and the Claw keeps following whatever the default becomes later.
   */
  fallbackProviderModelId?: string | null;
  fallbackChatModel?: string | null;
  onChange: (next: { providerModelId: string; chatModel: string | null } | null) => void;
  disabled?: boolean;
}) {
  const { data: providers, isLoading } = useLlmProviders();
  const list = providers ?? [];

  // Built once and shared by the option count, the selected-value resolution, and
  // the render below, so all three agree on exactly what is selectable.
  //
  // The provider's saved chatModel is UNIONED in, not used merely as a stand-in for
  // an empty discovery list. It is the model buildConfig actually sends
  // (llm-provider-service.ts:289), so treating the two as either/or hid it whenever
  // discovery had returned anything at all: the self-hosted gateway lists eight
  // models, none of them its own saved `llm-powerhouse-qwen-3-8`, which left that
  // model impossible to select even though it is what the provider runs on.
  // Refreshing models in Settings is still what fills in the rest.
  const baseGroups = list
    .map((provider) => {
      const discovered = modelsOf(provider.models);
      const entries = [...discovered];
      if (provider.chatModel && !entries.some((m) => (m.id ?? m.name) === provider.chatModel)) {
        entries.unshift({ id: provider.chatModel, name: provider.chatModel });
      }
      return {
        provider,
        // An entry with neither id nor name cannot be rendered as a SelectItem, so
        // counting it would both inflate optionCount and let the resolution below
        // settle on a value no item carries.
        entries: entries.filter((m) => Boolean(m.id ?? m.name)),
      };
    })
    .filter((g) => g.entries.length > 0);

  const effectiveProviderId = providerModelId ?? fallbackProviderModelId;
  // The pin's model only applies to the pin; when falling back, the default
  // provider's own chatModel is the one in play.
  const effectiveModel = providerModelId ? chatModel : fallbackChatModel;

  // Whatever will actually serve the turn is guaranteed a row, even if discovery
  // never listed it. Without this, an unmatched value leaves Radix showing its empty
  // placeholder, and quietly resolving to some other model instead would name the
  // wrong model for the turn — both worse than offering the real one.
  const groups = baseGroups.map((g) =>
    g.provider.id === effectiveProviderId &&
    effectiveModel &&
    !g.entries.some((m) => (m.id ?? m.name) === effectiveModel)
      ? { ...g, entries: [{ id: effectiveModel, name: effectiveModel }, ...g.entries] }
      : g,
  );

  // Total selectable models, not provider count — a single provider serving
  // eight models is still very much worth a switcher.
  const optionCount = groups.reduce((n, g) => n + g.entries.length, 0);
  if (!isLoading && optionCount < 2) return null;

  const group = effectiveProviderId
    ? groups.find((g) => g.provider.id === effectiveProviderId)
    : undefined;
  const resolvedModel = group
    ? effectiveModel && group.entries.some((m) => (m.id ?? m.name) === effectiveModel)
      ? effectiveModel
      : group.entries[0]?.id ?? group.entries[0]?.name ?? null
    : null;
  const value = group ? encodeValue(group.provider.id, resolvedModel) : SENTINEL;

  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(decodeValue(next))}
      disabled={disabled || isLoading}
    >
      <SelectTrigger
        aria-label="Model"
        className="h-8 w-auto max-w-[260px] gap-1.5 border-none bg-transparent px-2 text-xs shadow-none hover:bg-accent focus:ring-0 focus:ring-offset-0"
      >
        <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <SelectValue placeholder="Model" />
      </SelectTrigger>
      <SelectContent align="end" className="max-h-[420px]">
        <SelectItem value={SENTINEL}>Default model</SelectItem>

        {groups.map(({ provider, entries }) => {
          return (
            <SelectGroup key={provider.id}>
              <SelectSeparator />
              <SelectLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {provider.name}
              </SelectLabel>
              {entries.map((m) => {
                const id = m.id ?? m.name;
                if (!id) return null;
                return (
                  <SelectItem key={`${provider.id}-${id}`} value={encodeValue(provider.id, id)}>
                    {m.name ?? id}
                  </SelectItem>
                );
              })}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}

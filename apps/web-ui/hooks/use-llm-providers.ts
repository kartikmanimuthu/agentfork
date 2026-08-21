import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProviderType } from '@chatbot/shared';

export interface LlmProvider {
  id: string;
  tenantId: string;
  name: string;
  providerType: ProviderType;
  region: string | null;
  credentialsConfigured: boolean;
  credentialsHint: string | null;
  /** Non-secret endpoint values, so the edit form can prefill them. */
  endpoints?: { baseUrl?: string; gatewayUrl?: string };
  /** Names of the secrets already stored — never their values. */
  configuredSecrets?: string[];
  /** Decrypted secrets, present only when fetched with `withSecrets`. */
  secrets?: Record<string, string>;
  chatModel: string | null;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  maxBudgetUsd: number | null;
  models: unknown;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLlmProviderInput {
  name: string;
  providerType: ProviderType;
  region?: string;
  credentials: Record<string, string>;
  chatModel?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  maxBudgetUsd?: number;
  models?: Array<{ id: string; name: string; capabilities: string[] }>;
  isDefault?: boolean;
}

export interface UpdateLlmProviderInput {
  name?: string;
  providerType?: ProviderType;
  region?: string;
  credentials?: Record<string, string>;
  chatModel?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  maxBudgetUsd?: number;
  isDefault?: boolean;
}

export interface ValidateProviderInput {
  providerType: ProviderType;
  credentials: Record<string, string>;
  region?: string;
  /**
   * Validate against an existing provider: the server merges its stored secrets
   * under whatever was retyped, so re-discovering models after changing only the
   * base URL does not go out with an empty API key.
   */
  providerId?: string;
}

export interface ValidateProviderResponse {
  success: boolean;
  models?: Array<{ id: string; name: string; capabilities: string[] }>;
  error?: string;
}

async function fetchLlmProviders(): Promise<LlmProvider[]> {
  const res = await fetch('/api/llm-providers');
  if (!res.ok) throw new Error('Failed to fetch LLM providers');
  return res.json();
}

async function fetchLlmProvider(id: string, withSecrets = false): Promise<LlmProvider> {
  const res = await fetch(`/api/llm-providers/${id}${withSecrets ? '?withSecrets=1' : ''}`);
  if (!res.ok) throw new Error('Failed to fetch LLM provider');
  return res.json();
}

async function createLlmProvider(input: CreateLlmProviderInput): Promise<LlmProvider> {
  const res = await fetch('/api/llm-providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to create LLM provider');
  }
  return res.json();
}

async function updateLlmProvider(id: string, input: UpdateLlmProviderInput): Promise<LlmProvider> {
  const res = await fetch(`/api/llm-providers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to update LLM provider');
  }
  return res.json();
}

async function deleteLlmProvider(id: string): Promise<void> {
  const res = await fetch(`/api/llm-providers/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete LLM provider');
}

async function setDefaultLlmProvider(id: string): Promise<LlmProvider> {
  const res = await fetch(`/api/llm-providers/${id}/set-default`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to set default provider');
  }
  return res.json();
}

async function validateProvider(input: ValidateProviderInput): Promise<ValidateProviderResponse> {
  const res = await fetch('/api/llm-providers/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to validate provider');
  }
  return res.json();
}

async function refreshModels(id: string): Promise<LlmProvider> {
  const res = await fetch(`/api/llm-providers/${id}/refresh-models`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to refresh models');
  }
  return res.json();
}

export const llmProviderKeys = {
  all: ['llm-providers'] as const,
  lists: () => [...llmProviderKeys.all, 'list'] as const,
  details: () => [...llmProviderKeys.all, 'detail'] as const,
  detail: (id: string) => [...llmProviderKeys.details(), id] as const,
};

export function useLlmProviders() {
  return useQuery({ queryKey: llmProviderKeys.lists(), queryFn: fetchLlmProviders });
}

/**
 * `withSecrets` asks the server for the decrypted credentials so the edit form can
 * prefill them. Only the edit page passes it — and it is part of the query key, so
 * a cached secret-free detail response is never mistaken for a complete one.
 */
export function useLlmProvider(id: string, options: { withSecrets?: boolean } = {}) {
  const withSecrets = options.withSecrets ?? false;
  return useQuery({
    queryKey: [...llmProviderKeys.detail(id), { withSecrets }],
    queryFn: () => fetchLlmProvider(id, withSecrets),
    enabled: Boolean(id),
  });
}

export function useCreateLlmProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createLlmProvider,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: llmProviderKeys.lists() }),
  });
}

export function useUpdateLlmProvider(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateLlmProviderInput) => updateLlmProvider(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: llmProviderKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: llmProviderKeys.lists() });
    },
  });
}

export function useDeleteLlmProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteLlmProvider,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: llmProviderKeys.lists() }),
  });
}

export function useSetDefaultLlmProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setDefaultLlmProvider,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: llmProviderKeys.lists() }),
  });
}

export function useValidateProvider() {
  return useMutation({ mutationFn: validateProvider });
}

export function useRefreshModels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: refreshModels,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: llmProviderKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: llmProviderKeys.lists() });
    },
  });
}

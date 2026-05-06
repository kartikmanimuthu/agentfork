import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface LlmProvider {
  id: string;
  tenantId: string;
  name: string;
  provider: 'bedrock' | 'openai';
  chatModel: string | null;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  baseUrl: string | null;
  apiKey: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLlmProviderInput {
  name: string;
  provider: 'bedrock' | 'openai';
  chatModel?: string | null;
  embeddingModel?: string | null;
  embeddingDimensions?: number | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  isDefault?: boolean;
}

export interface UpdateLlmProviderInput {
  name?: string;
  provider?: 'bedrock' | 'openai';
  chatModel?: string | null;
  embeddingModel?: string | null;
  embeddingDimensions?: number | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  isDefault?: boolean;
}

async function fetchLlmProviders(): Promise<LlmProvider[]> {
  const res = await fetch('/api/llm-providers');
  if (!res.ok) throw new Error('Failed to fetch LLM providers');
  return res.json();
}

async function fetchLlmProvider(id: string): Promise<LlmProvider> {
  const res = await fetch(`/api/llm-providers/${id}`);
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

export const llmProviderKeys = {
  all: ['llm-providers'] as const,
  lists: () => [...llmProviderKeys.all, 'list'] as const,
  details: () => [...llmProviderKeys.all, 'detail'] as const,
  detail: (id: string) => [...llmProviderKeys.details(), id] as const,
};

export function useLlmProviders() {
  return useQuery({ queryKey: llmProviderKeys.lists(), queryFn: fetchLlmProviders });
}

export function useLlmProvider(id: string) {
  return useQuery({
    queryKey: llmProviderKeys.detail(id),
    queryFn: () => fetchLlmProvider(id),
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

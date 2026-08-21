import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export type TranscriptionProviderType = 'VLLM' | 'LITELLM' | 'OPENAI_COMPATIBLE' | 'CUSTOM';

export interface TranscriptionProvider {
  id: string;
  tenantId: string;
  name: string;
  providerType: TranscriptionProviderType;
  contract: string;
  endpointUrl: string | null;
  region: string | null;
  modelId: string | null;
  credentialsConfigured: boolean;
  credentialsHint: string | null;
  models: unknown;
  isDefault: boolean;
  activeVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTranscriptionProviderInput {
  name: string;
  providerType: TranscriptionProviderType;
  contract?: string;
  endpointUrl?: string;
  region?: string;
  credentials?: Record<string, string>;
  modelId?: string;
  models?: Array<{ id: string; name: string; capabilities: string[] }>;
  isDefault?: boolean;
}

export interface UpdateTranscriptionProviderInput {
  name?: string;
  providerType?: TranscriptionProviderType;
  contract?: string;
  endpointUrl?: string;
  region?: string;
  credentials?: Record<string, string>;
  modelId?: string;
  isDefault?: boolean;
}

export interface ValidateTranscriptionProviderInput {
  providerType: TranscriptionProviderType;
  endpointUrl?: string;
  credentials?: Record<string, string>;
  region?: string;
}

export interface ValidateTranscriptionProviderResponse {
  success: boolean;
  models?: Array<{ id: string; name: string; capabilities: string[] }>;
  error?: string;
}

export interface TranscriptionProviderVersion {
  id: string;
  modelId: string;
  version: number;
  changeNotes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

async function fetchProviders(): Promise<TranscriptionProvider[]> {
  const res = await fetch('/api/transcription/models');
  if (!res.ok) throw new Error('Failed to fetch transcription providers');
  return res.json();
}

async function fetchProvider(id: string): Promise<TranscriptionProvider> {
  const res = await fetch(`/api/transcription/models/${id}`);
  if (!res.ok) throw new Error('Failed to fetch transcription provider');
  return res.json();
}

async function createProvider(input: CreateTranscriptionProviderInput): Promise<TranscriptionProvider> {
  const res = await fetch('/api/transcription/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to create transcription provider');
  }
  return res.json();
}

async function updateProvider(id: string, input: UpdateTranscriptionProviderInput): Promise<TranscriptionProvider> {
  const res = await fetch(`/api/transcription/models/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to update transcription provider');
  }
  return res.json();
}

async function deleteProvider(id: string): Promise<void> {
  const res = await fetch(`/api/transcription/models/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete transcription provider');
}

async function validateProvider(input: ValidateTranscriptionProviderInput): Promise<ValidateTranscriptionProviderResponse> {
  const res = await fetch('/api/transcription/models/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Validation failed');
  }
  return res.json();
}

async function refreshModels(id: string): Promise<TranscriptionProvider> {
  const res = await fetch(`/api/transcription/models/${id}/refresh-models`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to refresh models');
  }
  return res.json();
}

async function fetchVersions(modelId: string): Promise<TranscriptionProviderVersion[]> {
  const res = await fetch(`/api/transcription/models/${modelId}/versions`);
  if (!res.ok) throw new Error('Failed to fetch versions');
  return res.json();
}

async function createVersion(modelId: string, changeNotes?: string): Promise<TranscriptionProviderVersion> {
  const res = await fetch(`/api/transcription/models/${modelId}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changeNotes }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to create version');
  }
  return res.json();
}

async function publishVersion(modelId: string, versionId: string): Promise<TranscriptionProviderVersion> {
  const res = await fetch(`/api/transcription/models/${modelId}/versions/${versionId}/publish`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Failed to publish version');
  }
  return res.json();
}

export interface TestVersionSegment {
  start?: number;
  end?: number;
  text: string;
  speaker?: string;
}

export interface TestVersionResult {
  text: string;
  language: string | null;
  durationSec: number | null;
  segments: TestVersionSegment[] | null;
  stub: boolean;
}

async function testVersion(
  modelId: string,
  versionId: string,
  file: File,
  language?: string,
  diarize?: boolean
): Promise<TestVersionResult> {
  const form = new FormData();
  form.append('file', file);
  if (language) form.append('language', language);
  if (diarize) form.append('diarize', 'true');
  const res = await fetch(`/api/transcription/models/${modelId}/versions/${versionId}/test`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Test failed');
  return data;
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const transcriptionProviderKeys = {
  all: ['transcription-providers'] as const,
  lists: () => [...transcriptionProviderKeys.all, 'list'] as const,
  details: () => [...transcriptionProviderKeys.all, 'detail'] as const,
  detail: (id: string) => [...transcriptionProviderKeys.details(), id] as const,
  versions: (modelId: string) => [...transcriptionProviderKeys.all, 'versions', modelId] as const,
};

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useTranscriptionProviders() {
  return useQuery({ queryKey: transcriptionProviderKeys.lists(), queryFn: fetchProviders });
}

export function useTranscriptionProvider(id: string) {
  return useQuery({
    queryKey: transcriptionProviderKeys.detail(id),
    queryFn: () => fetchProvider(id),
    enabled: Boolean(id),
  });
}

export function useCreateTranscriptionProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProvider,
    onSuccess: () => qc.invalidateQueries({ queryKey: transcriptionProviderKeys.lists() }),
  });
}

export function useUpdateTranscriptionProvider(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTranscriptionProviderInput) => updateProvider(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: transcriptionProviderKeys.detail(id) });
      qc.invalidateQueries({ queryKey: transcriptionProviderKeys.lists() });
    },
  });
}

export function useDeleteTranscriptionProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteProvider,
    onSuccess: () => qc.invalidateQueries({ queryKey: transcriptionProviderKeys.lists() }),
  });
}

export function useSetDefaultTranscriptionProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => updateProvider(id, { isDefault: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: transcriptionProviderKeys.lists() }),
  });
}

export function useValidateTranscriptionProvider() {
  return useMutation({ mutationFn: validateProvider });
}

export function useRefreshTranscriptionModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: refreshModels,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: transcriptionProviderKeys.detail(data.id) });
      qc.invalidateQueries({ queryKey: transcriptionProviderKeys.lists() });
    },
  });
}

export function useTranscriptionVersions(modelId: string) {
  return useQuery({
    queryKey: transcriptionProviderKeys.versions(modelId),
    queryFn: () => fetchVersions(modelId),
    enabled: Boolean(modelId),
  });
}

export function useCreateTranscriptionVersion(modelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (changeNotes?: string) => createVersion(modelId, changeNotes),
    onSuccess: () => qc.invalidateQueries({ queryKey: transcriptionProviderKeys.versions(modelId) }),
  });
}

export function usePublishTranscriptionVersion(modelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => publishVersion(modelId, versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: transcriptionProviderKeys.versions(modelId) });
      qc.invalidateQueries({ queryKey: transcriptionProviderKeys.detail(modelId) });
      qc.invalidateQueries({ queryKey: transcriptionProviderKeys.lists() });
    },
  });
}

export function useTestTranscriptionVersion(modelId: string) {
  return useMutation({
    mutationFn: ({ versionId, file, language, diarize }: { versionId: string; file: File; language?: string; diarize?: boolean }) =>
      testVersion(modelId, versionId, file, language, diarize),
  });
}

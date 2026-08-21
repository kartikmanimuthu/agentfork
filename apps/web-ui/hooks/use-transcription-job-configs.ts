import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface TranscriptionJobConfig {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: string;
  modelId: string | null;
  versionId: string | null;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  model?: { id: string; name: string; providerType: string; modelId: string | null } | null;
  version?: { id: string; version: number; status: string } | null;
  _count?: { apiKeys: number; inferences: number };
}

export interface JobConfigVersion {
  id: string;
  jobConfigId: string;
  version: number;
  status: string;
  config: Record<string, unknown>;
  changeNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobConfigInput {
  name: string;
  description?: string;
  modelId?: string;
  versionId?: string;
  config?: Record<string, unknown>;
}

export interface UpdateJobConfigInput {
  name?: string;
  description?: string | null;
  modelId?: string | null;
  versionId?: string | null;
  config?: Record<string, unknown>;
  status?: string;
}

export function useTranscriptionJobConfigs(search?: string, status?: string) {
  return useQuery({
    queryKey: ['transcription-job-configs', { search, status }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (status) params.append('status', status);
      params.append('pageSize', '100');
      const res = await fetch(`/api/transcription/job-configs?${params}`);
      if (!res.ok) throw new Error('Failed to fetch job configs');
      return res.json() as Promise<{ items: TranscriptionJobConfig[]; total: number; page: number; pageSize: number }>;
    },
  });
}

export function useTranscriptionJobConfig(id: string) {
  return useQuery({
    queryKey: ['transcription-job-config', id],
    queryFn: async () => {
      const res = await fetch(`/api/transcription/job-configs/${id}`);
      if (!res.ok) throw new Error('Failed to fetch job config');
      return res.json() as Promise<TranscriptionJobConfig>;
    },
    enabled: Boolean(id),
  });
}

export function useTranscriptionJobConfigVersions(id?: string) {
  return useQuery({
    queryKey: ['transcription-job-config-versions', id],
    queryFn: async () => {
      const res = await fetch(`/api/transcription/job-configs/${id}/versions`);
      if (!res.ok) throw new Error('Failed to fetch job config versions');
      return res.json() as Promise<JobConfigVersion[]>;
    },
    enabled: Boolean(id),
  });
}

export function useCreateTranscriptionJobConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateJobConfigInput) => {
      const res = await fetch('/api/transcription/job-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to create job config');
      return res.json() as Promise<TranscriptionJobConfig>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transcription-job-configs'] }),
  });
}

export function useUpdateTranscriptionJobConfig(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateJobConfigInput) => {
      const res = await fetch(`/api/transcription/job-configs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to update job config');
      return res.json() as Promise<TranscriptionJobConfig>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transcription-job-config', id] });
      qc.invalidateQueries({ queryKey: ['transcription-job-configs'] });
    },
  });
}

export function useDeleteTranscriptionJobConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/transcription/job-configs/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete job config');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transcription-job-configs'] }),
  });
}

export function useCreateTranscriptionJobConfigVersion(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (changeNotes?: string) => {
      const res = await fetch(`/api/transcription/job-configs/${id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeNotes }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to create version');
      return res.json() as Promise<JobConfigVersion>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transcription-job-config-versions', id] }),
  });
}

export function usePublishTranscriptionJobConfigVersion(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (versionId: string) => {
      const res = await fetch(`/api/transcription/job-configs/${id}/versions/${versionId}/publish`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to publish version');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transcription-job-config-versions', id] });
      qc.invalidateQueries({ queryKey: ['transcription-job-config', id] });
    },
  });
}

export interface PlaygroundTestSegment {
  start?: number;
  end?: number;
  text: string;
  speaker?: string;
}

export interface PlaygroundTestInput {
  audioBase64: string;
  mimeType: string;
  fileName?: string;
  /** Ephemeral test-time overrides — not persisted to the job config. */
  modelId?: string;
  language?: string;
  diarize?: boolean;
}

export function useTestTranscriptionJobConfig(id?: string) {
  return useMutation({
    mutationFn: async (input: PlaygroundTestInput) => {
      const res = await fetch(`/api/transcription/job-configs/${id}/playground`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Test failed');
      return res.json() as Promise<{ text: string; language: string | null; durationSec: number | null; segments: PlaygroundTestSegment[] | null; outputS3Key: string | null }>;
    },
  });
}

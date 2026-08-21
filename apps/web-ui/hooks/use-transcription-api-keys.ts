import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface TranscriptionApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  jobConfigId: string | null;
  modelId: string | null;
  dailyReqLimit: number;
  dailyMinutesLimit: number;
  minuteReqLimit: number;
  webhookUrl: string | null;
  createdAt: string;
}

export function useTranscriptionApiKeys(jobConfigId?: string) {
  return useQuery({
    queryKey: ['transcription-api-keys', { jobConfigId }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (jobConfigId) params.append('jobConfigId', jobConfigId);
      const res = await fetch(`/api/transcription/api-keys?${params}`);
      if (!res.ok) throw new Error('Failed to fetch API keys');
      return res.json() as Promise<TranscriptionApiKey[]>;
    },
  });
}

export function useCreateTranscriptionApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      jobConfigId?: string;
      modelId?: string;
      webhookUrl?: string;
      dailyReqLimit?: number;
      dailyMinutesLimit?: number;
      minuteReqLimit?: number;
    }) => {
      const res = await fetch('/api/transcription/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to create API key');
      return res.json() as Promise<{ rawKey: string; apiKey: { id: string; name: string; keyPrefix: string } }>;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['transcription-api-keys'] });
      if (vars.jobConfigId) {
        qc.invalidateQueries({ queryKey: ['transcription-api-keys', { jobConfigId: vars.jobConfigId }] });
      }
    },
  });
}

export function useRevokeTranscriptionApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/transcription/api-keys/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (!res.ok) throw new Error('Failed to revoke key');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transcription-api-keys'] }),
  });
}

export function useWebhookSecretStatus(apiKeyId?: string) {
  return useQuery({
    queryKey: ['transcription-webhook-secret-status', apiKeyId],
    queryFn: async () => {
      const res = await fetch(`/api/transcription/api-keys/${apiKeyId}/webhook-secret`);
      if (!res.ok) throw new Error('Failed to get webhook secret status');
      return res.json() as Promise<{ hasSecret: boolean; hint: string | null }>;
    },
    enabled: Boolean(apiKeyId),
  });
}

export function useRotateWebhookSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (apiKeyId: string) => {
      const res = await fetch(`/api/transcription/api-keys/${apiKeyId}/webhook-secret`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to rotate secret');
      return res.json() as Promise<{ rawSecret: string; hasSecret: boolean }>;
    },
    onSuccess: (_, apiKeyId) => qc.invalidateQueries({ queryKey: ['transcription-webhook-secret-status', apiKeyId] }),
  });
}

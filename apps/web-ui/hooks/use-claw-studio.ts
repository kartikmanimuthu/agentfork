import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface StudioSummary {
  id: string;
  studioId: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  claw: { id: string; name: string } | null;
}

export interface ProvisionResult {
  studioId: string;
  password: string;
  studioRecordId: string;
  clawId: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function useClawStudio() {
  return useQuery({
    queryKey: ['claw-studio'],
    queryFn: async () => {
      const res = await fetch('/api/claw-studio');
      const data = await json<{ studio: StudioSummary | null }>(res);
      return data.studio;
    },
  });
}

export function useProvisionStudio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/claw-studio', { method: 'POST', body: '{}' });
      return json<ProvisionResult>(res);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claw-studio'] }),
  });
}

export function useResetStudioPassword() {
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/claw-studio/reset-password', { method: 'POST', body: '{}' });
      return json<{ password: string }>(res);
    },
  });
}

// ---------------------------------------------------------------------------
// Multi-account
//
// Each account is a separate tenant, so these span every tenant the user
// belongs to rather than the one chatflow is currently scoped to. That is why
// they are separate hooks from the tenant-scoped ones above rather than a
// widened version of them.
// ---------------------------------------------------------------------------

export interface StudioAccount extends StudioSummary {
  tenantId: string;
  tenantName: string;
  isCurrentTenant: boolean;
}

export interface CreateAccountResult extends ProvisionResult {
  tenantId: string;
  tenantName: string;
}

const accountsKey = ['claw-studio', 'accounts'] as const;

export function useStudioAccounts() {
  return useQuery({
    queryKey: accountsKey,
    queryFn: async () => {
      const res = await fetch('/api/claw-studio/accounts');
      const data = await json<{ accounts: StudioAccount[] }>(res);
      return data.accounts;
    },
  });
}

export function useCreateStudioAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (label: string) => {
      const res = await fetch('/api/claw-studio/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      return json<CreateAccountResult>(res);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountsKey });
      // The tenant-scoped view can also change: creating the very first account
      // while the current tenant has no studio leaves that query stale.
      void qc.invalidateQueries({ queryKey: ['claw-studio'] });
    },
  });
}

export function useResetAccountPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (studioRecordId: string) => {
      const res = await fetch(`/api/claw-studio/accounts/${studioRecordId}/reset-password`, {
        method: 'POST',
      });
      return json<{ password: string; studioId: string; studioRecordId: string }>(res);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
  });
}

export function useRenameStudioAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ studioRecordId, label }: { studioRecordId: string; label: string }) => {
      const res = await fetch(`/api/claw-studio/accounts/${studioRecordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      return json<{ studioRecordId: string; tenantId: string; tenantName: string }>(res);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
  });
}

export function useDeleteStudioAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (studioRecordId: string) => {
      const res = await fetch(`/api/claw-studio/accounts/${studioRecordId}`, { method: 'DELETE' });
      return json<{ tenantId: string; tenantName: string; deleted: Record<string, number> }>(res);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountsKey });
      // The deleted tenant may have been the one the tenant-scoped view was
      // reading, and its LLM providers/agents lists are now stale too.
      void qc.invalidateQueries({ queryKey: ['claw-studio'] });
    },
  });
}

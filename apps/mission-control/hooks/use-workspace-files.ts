import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BASE_PATH } from '@/lib/base-path';

export interface WorkspaceFileDTO {
  slug: string;
  content: string;
  version: number;
  updatedBy: string;
  updatedAt: string;
  label: { title: string; blurb: string };
  charCap: number;
}

export interface WorkspaceRevisionDTO {
  version: number;
  updatedBy: string;
  reason: string | null;
  createdAt: string;
}

const workspaceKeys = {
  all: ['workspace-files'] as const,
  list: () => [...workspaceKeys.all, 'list'] as const,
  revisions: (slug: string) => [...workspaceKeys.all, 'revisions', slug] as const,
};

async function unwrap<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return body.data as T;
}

export function useWorkspaceFiles() {
  return useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: () => fetch(`${BASE_PATH}/api/files`).then((r) => unwrap<WorkspaceFileDTO[]>(r)),
  });
}

export function useSaveWorkspaceFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, content }: { slug: string; content: string }) =>
      fetch(`${BASE_PATH}/api/files/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }).then((r) => unwrap<WorkspaceFileDTO>(r)),
    onSuccess: () => qc.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}

export function useWorkspaceRevisions(slug: string | null) {
  return useQuery({
    queryKey: workspaceKeys.revisions(slug ?? ''),
    queryFn: () => fetch(`${BASE_PATH}/api/files/${slug}/revisions`).then((r) => unwrap<WorkspaceRevisionDTO[]>(r)),
    enabled: !!slug,
  });
}

export function useRestoreWorkspaceRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, version }: { slug: string; version: number }) =>
      fetch(`${BASE_PATH}/api/files/${slug}/revisions/${version}/restore`, { method: 'POST' })
        .then((r) => unwrap<WorkspaceFileDTO>(r)),
    onSuccess: () => qc.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}

import { useQuery, useMutation } from '@tanstack/react-query';
import { BASE_PATH } from '@/lib/base-path';

export interface StudioProfile {
  id: string;
  studioId: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  claw: { id: string; name: string } | null;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(data?.error ?? fallback);
  }
  return data as T;
}

async function fetchStudioProfile(): Promise<StudioProfile> {
  const res = await fetch(`${BASE_PATH}/api/studio/profile`);
  const data = await unwrap<{ data: StudioProfile }>(res, 'Failed to load profile');
  return data.data;
}

async function resetStudioPassword(): Promise<{ password: string }> {
  const res = await fetch(`${BASE_PATH}/api/studio/reset-password`, { method: 'POST' });
  const data = await unwrap<{ data: { password: string } }>(res, 'Failed to reset password');
  return data.data;
}

export function useStudioProfile() {
  return useQuery({ queryKey: ['studio-profile'], queryFn: fetchStudioProfile });
}

export function useResetStudioPassword() {
  return useMutation({ mutationFn: resetStudioPassword });
}

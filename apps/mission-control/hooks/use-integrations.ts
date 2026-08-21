import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BASE_PATH } from '@/lib/base-path';

export type IntegrationId =
  | 'github'
  | 'hubspot'
  | 'email'
  | 'notion'
  | 'gmail'
  | 'google_calendar'
  | 'google_drive'
  | 'outlook'
  | 'jira'
  | 'linear'
  | 'gitlab'
  | 'confluence'
  | 'zendesk'
  | 'clickup'
  | 'asana'
  | 'attio'
  | 'apollo'
  | 'hunter'
  | 'close'
  | 'stripe'
  | 'quickbooks'
  | 'docusign'
  | 'dropbox'
  | 'box'
  | 'posthog'
  | 'mixpanel'
  | 'amplitude'
  | 'figma'
  | 'canva'
  | 'whatsapp';
export type AccountMode = 'single' | 'multi';
export type AuthMode = 'manual' | 'oauth';

export interface IntegrationAccountSummary {
  accountId: string;
  label: string;
  isDefault: boolean;
  /** Secret values arrive already masked; non-secret values are verbatim. */
  fields: Record<string, string>;
}

export interface IntegrationSummary {
  name: IntegrationId;
  displayName: string;
  description: string;
  accountMode: AccountMode;
  authMode: AuthMode;
  accountCount: number;
}

export interface IntegrationDetail {
  name: IntegrationId;
  displayName: string;
  description: string;
  accountMode: AccountMode;
  authMode: AuthMode;
  accounts: IntegrationAccountSummary[];
}

export interface IntegrationTestResult {
  detail: string;
  [key: string]: string;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(data?.error ?? fallback);
  }
  return data as T;
}

async function fetchIntegrations(): Promise<IntegrationSummary[]> {
  const res = await fetch(`${BASE_PATH}/api/integrations`);
  const data = await unwrap<{ integrations: IntegrationSummary[] }>(res, 'Failed to load integrations');
  return data.integrations;
}

async function fetchIntegration(name: IntegrationId): Promise<IntegrationDetail> {
  const res = await fetch(`${BASE_PATH}/api/integrations/${name}`);
  const data = await unwrap<{ data: IntegrationDetail }>(res, 'Failed to load integration');
  return data.data;
}

async function addIntegrationAccount(
  name: IntegrationId,
  fields: Record<string, string>,
): Promise<IntegrationAccountSummary> {
  const res = await fetch(`${BASE_PATH}/api/integrations/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = await unwrap<{ data: IntegrationAccountSummary }>(res, 'Failed to connect account');
  return data.data;
}

async function updateIntegrationAccount(
  name: IntegrationId,
  accountId: string,
  input: Record<string, string | boolean | undefined>,
): Promise<IntegrationAccountSummary> {
  const res = await fetch(`${BASE_PATH}/api/integrations/${name}/accounts/${accountId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await unwrap<{ data: IntegrationAccountSummary }>(res, 'Failed to update account');
  return data.data;
}

async function removeIntegrationAccount(name: IntegrationId, accountId: string): Promise<void> {
  const res = await fetch(`${BASE_PATH}/api/integrations/${name}/accounts/${accountId}`, { method: 'DELETE' });
  await unwrap(res, 'Failed to remove account');
}

async function disconnectIntegration(name: IntegrationId): Promise<void> {
  const res = await fetch(`${BASE_PATH}/api/integrations/${name}`, { method: 'DELETE' });
  await unwrap(res, 'Failed to disconnect integration');
}

async function testIntegration(
  name: IntegrationId,
  body: { accountId?: string; overrides?: Record<string, string> },
): Promise<IntegrationTestResult> {
  const res = await fetch(`${BASE_PATH}/api/integrations/${name}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await unwrap<{ data: IntegrationTestResult }>(res, 'Connection test failed');
  return data.data;
}

export const integrationKeys = {
  all: ['integrations'] as const,
  lists: () => [...integrationKeys.all, 'list'] as const,
  details: () => [...integrationKeys.all, 'detail'] as const,
  detail: (name: IntegrationId) => [...integrationKeys.details(), name] as const,
};

export function useIntegrations() {
  return useQuery({ queryKey: integrationKeys.lists(), queryFn: fetchIntegrations });
}

export function useIntegration(name: IntegrationId) {
  return useQuery({
    queryKey: integrationKeys.detail(name),
    queryFn: () => fetchIntegration(name),
    enabled: Boolean(name),
  });
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>, name: IntegrationId) {
  queryClient.invalidateQueries({ queryKey: integrationKeys.detail(name) });
  queryClient.invalidateQueries({ queryKey: integrationKeys.lists() });
}

export function useAddIntegrationAccount(name: IntegrationId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fields: Record<string, string>) => addIntegrationAccount(name, fields),
    onSuccess: () => invalidate(queryClient, name),
  });
}

export function useUpdateIntegrationAccount(name: IntegrationId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, input }: { accountId: string; input: Record<string, string | boolean | undefined> }) =>
      updateIntegrationAccount(name, accountId, input),
    onSuccess: () => invalidate(queryClient, name),
  });
}

export function useRemoveIntegrationAccount(name: IntegrationId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => removeIntegrationAccount(name, accountId),
    onSuccess: () => invalidate(queryClient, name),
  });
}

export function useTestIntegration(name: IntegrationId) {
  return useMutation({
    mutationFn: (body: { accountId?: string; overrides?: Record<string, string> }) => testIntegration(name, body),
  });
}

export function useDisconnectIntegration(name: IntegrationId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectIntegration(name),
    onSuccess: () => invalidate(queryClient, name),
  });
}

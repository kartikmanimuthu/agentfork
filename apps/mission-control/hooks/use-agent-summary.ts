import { useQuery } from '@tanstack/react-query';
import { BASE_PATH } from '@/lib/base-path';

export interface AgentChannelSummary {
  channel: string;
  displayName: string;
  configured: boolean;
  enabled: boolean;
}

export interface AgentSummaryDTO {
  files: number;
  skills: { enabled: number; total: number };
  memories: number;
  mcp: { active: number; total: number };
  channels: AgentChannelSummary[];
  channelsEnabled: number;
  autoApprove: boolean;
  /** The Claw's pinned provider, or null when it follows the tenant default. */
  providerModelId: string | null;
  /** The pinned model within that provider, or null to use the provider's own chatModel. */
  chatModel: string | null;
  /**
   * The tenant's isDefault provider — what `resolveClawRuntime` actually falls back
   * to when `providerModelId` is null. Reported separately from the pin so the chat
   * header can display it without the client echoing it back as an override.
   */
  defaultProviderModelId: string | null;
  /** That default provider's own chatModel. */
  defaultChatModel: string | null;
  provider: { name: string; providerType: string; chatModel: string | null } | null;
}

export interface AgentToolGroupDTO {
  source: string;
  displayName: string;
  tools: Array<{ name: string; description: string; mutative: boolean }>;
  note?: string;
}

async function unwrap<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return body.data as T;
}

export function useAgentSummary() {
  return useQuery({
    queryKey: ['agent', 'summary'],
    queryFn: () => fetch(`${BASE_PATH}/api/agent/summary`).then((r) => unwrap<AgentSummaryDTO>(r)),
  });
}

export function useAgentTools(enabled: boolean) {
  return useQuery({
    queryKey: ['agent', 'tools'],
    queryFn: () => fetch(`${BASE_PATH}/api/agent/tools`).then((r) => unwrap<AgentToolGroupDTO[]>(r)),
    enabled,
  });
}

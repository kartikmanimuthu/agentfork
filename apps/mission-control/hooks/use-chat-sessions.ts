import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BASE_PATH } from '@/lib/base-path';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** ISO string, stamped when the message is created. Absent on messages saved
   *  before timestamps existed — render nothing rather than inventing one. */
  createdAt?: string;
  /**
   * The ClawRun this assistant message came from, so its process — tool calls,
   * thinking, tokens, response time — can be fetched back on demand long after
   * the live stream is gone. Assistant messages only, and only from the turn this
   * was introduced onward.
   */
  runId?: string;
}

export interface ChatSession {
  id: string;
  name: string;
  threadId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(data?.error ?? fallback);
  }
  return data as T;
}

async function fetchSessions(): Promise<ChatSession[]> {
  const res = await fetch(`${BASE_PATH}/api/chat-sessions`);
  const data = await unwrap<{ data: ChatSession[] }>(res, 'Failed to load chat sessions');
  return data.data;
}

async function createSession(name?: string): Promise<ChatSession> {
  const res = await fetch(`${BASE_PATH}/api/chat-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(name ? { name } : {}),
  });
  const data = await unwrap<{ data: ChatSession }>(res, 'Failed to create chat session');
  return data.data;
}

async function updateSession(
  sessionId: string,
  patch: Partial<Pick<ChatSession, 'name' | 'messages'>>,
): Promise<ChatSession> {
  const res = await fetch(`${BASE_PATH}/api/chat-sessions/${sessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await unwrap<{ data: ChatSession }>(res, 'Failed to update chat session');
  return data.data;
}

async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${BASE_PATH}/api/chat-sessions/${sessionId}`, { method: 'DELETE' });
  await unwrap(res, 'Failed to delete chat session');
}

export const chatSessionKeys = {
  all: ['chat-sessions'] as const,
  list: () => [...chatSessionKeys.all, 'list'] as const,
};

export function useChatSessions() {
  return useQuery({ queryKey: chatSessionKeys.list(), queryFn: fetchSessions });
}

export function useCreateChatSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name?: string) => createSession(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatSessionKeys.list() }),
  });
}

export function useUpdateChatSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, patch }: { sessionId: string; patch: Partial<Pick<ChatSession, 'name' | 'messages'>> }) =>
      updateSession(sessionId, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatSessionKeys.list() }),
  });
}

export function useDeleteChatSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatSessionKeys.list() }),
  });
}

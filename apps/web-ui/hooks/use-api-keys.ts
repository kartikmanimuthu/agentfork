'use client';

import { useState, useCallback } from 'react';

export interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  scopes: string[];
  dailyReqLimit: number;
  dailyTokenLimit: number;
  expiresAt: string | null;
  createdAt: string;
  rawKey?: string;
}

const SESSION_KEY = 'chatbot:api-key-cache';

function readCache(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeCache(id: string, rawKey: string) {
  try {
    const cache = readCache();
    cache[id] = rawKey;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(cache));
  } catch {
    // sessionStorage unavailable (SSR, private mode)
  }
}

function deleteFromCache(id: string) {
  try {
    const cache = readCache();
    delete cache[id];
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

export function useApiKeys(agentId: string) {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/api-keys`);
      if (!res.ok) throw new Error('Failed to fetch API keys');
      const data: ApiKeyItem[] = await res.json();
      const cache = readCache();
      setKeys(data.map((k) => ({ ...k, rawKey: cache[k.id] })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  const createKey = useCallback(async (input: Record<string, unknown>) => {
    const res = await fetch(`/api/agents/${agentId}/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('Failed to create API key');
    const result = await res.json() as { rawKey?: string; apiKey?: { id: string } };
    if (result.rawKey && result.apiKey?.id) {
      writeCache(result.apiKey.id, result.rawKey);
    }
    return result;
  }, [agentId]);

  const revokeKey = useCallback(async (keyId: string) => {
    deleteFromCache(keyId);
    await fetch(`/api/agents/${agentId}/api-keys/${keyId}/revoke`, { method: 'POST' });
    await fetchKeys();
  }, [agentId, fetchKeys]);

  return { keys, loading, error, fetchKeys, createKey, revokeKey };
}

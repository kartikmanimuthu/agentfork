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
      const data = await res.json();
      setKeys(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  const createKey = useCallback(async (input: { name: string; dailyReqLimit?: number; dailyTokenLimit?: number }) => {
    const res = await fetch(`/api/agents/${agentId}/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('Failed to create API key');
    return res.json();
  }, [agentId]);

  const revokeKey = useCallback(async (keyId: string) => {
    await fetch(`/api/agents/${agentId}/api-keys/${keyId}/revoke`, { method: 'POST' });
    await fetchKeys();
  }, [agentId, fetchKeys]);

  return { keys, loading, error, fetchKeys, createKey, revokeKey };
}

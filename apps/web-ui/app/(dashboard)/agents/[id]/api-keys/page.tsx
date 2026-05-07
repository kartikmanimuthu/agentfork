'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useApiKeys } from '@/hooks/use-api-keys';
import { ApiKeyTable } from '@/components/api-keys/api-key-table';
import { CreateKeyDialog } from '@/components/api-keys/create-key-dialog';

export default function ApiKeysPage() {
  const params = useParams();
  const agentId = params.id as string;
  const { keys, loading, fetchKeys, createKey, revokeKey } = useApiKeys(agentId);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="text-sm text-muted-foreground">Manage API keys for external access to this agent.</p>
        </div>
        <CreateKeyDialog agentId={agentId} onCreate={createKey} onSuccess={fetchKeys} />
      </div>
      <ApiKeyTable keys={keys} loading={loading} onRevoke={revokeKey} />
    </div>
  );
}

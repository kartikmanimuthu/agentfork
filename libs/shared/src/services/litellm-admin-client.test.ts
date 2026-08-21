import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiteLLMAdminClient, LiteLLMProvisioningError } from './litellm-admin-client';

describe('LiteLLMAdminClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('generateVirtualKey', () => {
    it('POSTs to /key/generate with the master key and returns the generated key', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ key: 'sk-generated-123' }),
      });

      const client = new LiteLLMAdminClient('http://gateway:4000', 'sk-master');
      const result = await client.generateVirtualKey({
        tenantId: 't1',
        keyAlias: 'tenant-t1-abc',
        maxBudgetUsd: 25,
      });

      expect(result).toEqual({ key: 'sk-generated-123' });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://gateway:4000/key/generate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-master',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            key_alias: 'tenant-t1-abc',
            max_budget: 25,
            metadata: { tenantId: 't1' },
          }),
        })
      );
    });

    it('omits max_budget when maxBudgetUsd is not provided', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ key: 'sk-x' }) });
      const client = new LiteLLMAdminClient('http://gateway:4000', 'sk-master');
      await client.generateVirtualKey({ tenantId: 't1', keyAlias: 'tenant-t1-abc' });

      const [, options] = fetchMock.mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({
        key_alias: 'tenant-t1-abc',
        max_budget: undefined,
        metadata: { tenantId: 't1' },
      });
    });

    it('throws LiteLLMProvisioningError on a non-2xx response', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' });
      const client = new LiteLLMAdminClient('http://gateway:4000', 'sk-bad');
      await expect(
        client.generateVirtualKey({ tenantId: 't1', keyAlias: 'tenant-t1-abc' })
      ).rejects.toThrow(LiteLLMProvisioningError);
    });

    it('retries once on network failure then succeeds', async () => {
      fetchMock
        .mockRejectedValueOnce(new Error('network blip'))
        .mockResolvedValueOnce({ ok: true, json: async () => ({ key: 'sk-retry-ok' }) });

      const client = new LiteLLMAdminClient('http://gateway:4000', 'sk-master');
      const result = await client.generateVirtualKey({ tenantId: 't1', keyAlias: 'tenant-t1-abc' });

      expect(result).toEqual({ key: 'sk-retry-ok' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws LiteLLMProvisioningError after exhausting retries', async () => {
      fetchMock.mockRejectedValue(new Error('gateway unreachable'));
      const client = new LiteLLMAdminClient('http://gateway:4000', 'sk-master');
      await expect(
        client.generateVirtualKey({ tenantId: 't1', keyAlias: 'tenant-t1-abc' })
      ).rejects.toThrow(LiteLLMProvisioningError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('revokeVirtualKey', () => {
    it('POSTs to /key/delete with the key_aliases array', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      const client = new LiteLLMAdminClient('http://gateway:4000', 'sk-master');
      await client.revokeVirtualKey('tenant-t1-abc');

      expect(fetchMock).toHaveBeenCalledWith(
        'http://gateway:4000/key/delete',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ key_aliases: ['tenant-t1-abc'] }),
        })
      );
    });

    it('throws LiteLLMProvisioningError on a non-2xx response', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });
      const client = new LiteLLMAdminClient('http://gateway:4000', 'sk-master');
      await expect(client.revokeVirtualKey('tenant-t1-abc')).rejects.toThrow(LiteLLMProvisioningError);
    });
  });
});

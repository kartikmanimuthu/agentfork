import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from '../env';
import { TranscriptionModelService } from './transcription-model-service';

// EncryptionService reads env.ENCRYPTION_KEY at construction time via a getter, not
// process.env directly — every test here builds a TranscriptionModelService (which
// constructs one), so stub the getter for the whole file rather than per test.
let encryptionKeySpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  encryptionKeySpy = vi.spyOn(env as any, 'ENCRYPTION_KEY', 'get').mockReturnValue('a'.repeat(64));
});
afterEach(() => {
  encryptionKeySpy.mockRestore();
});

function mockDb() {
  return {
    transcriptionModel: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null as any),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'model-1',
        tenantId: 'tenant-1',
        status: 'active',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        ...args.data,
      })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'model-1', ...args.data })),
      updateMany: vi.fn(async () => ({ count: 0 })),
      delete: vi.fn(async () => ({ id: 'model-1' })),
    },
    transcriptionModelVersion: {
      findFirst: vi.fn(async () => null as any),
    },
  };
}

describe('TranscriptionModelService', () => {
  let db: ReturnType<typeof mockDb>;
  let service: TranscriptionModelService;

  beforeEach(() => {
    db = mockDb();
    service = new TranscriptionModelService('tenant-1', db as any);
  });

  describe('create', () => {
    it('defaults providerType to CUSTOM and contract to "custom"', async () => {
      await service.create({ name: 'My Engine', endpointUrl: 'https://engine.example.com' } as any);
      const data = db.transcriptionModel.create.mock.calls[0][0].data;
      expect(data.providerType).toBe('CUSTOM');
      expect(data.contract).toBe('custom');
    });

    it('encrypts credentials before storing them', async () => {
      await service.create({
        name: 'My Engine',
        endpointUrl: 'https://engine.example.com',
        credentials: { apiKey: 'super-secret' },
      } as any);
      const data = db.transcriptionModel.create.mock.calls[0][0].data;
      expect(data.credentials).not.toContain('super-secret');
      expect(typeof data.credentials).toBe('string');
    });

    it('clears any existing default before creating a new default', async () => {
      await service.create({ name: 'My Engine', endpointUrl: 'https://engine.example.com', isDefault: true } as any);
      expect(db.transcriptionModel.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', isDefault: true },
        data: { isDefault: false },
      });
    });

    it('throws for a non-LITELLM provider with no endpoint URL', async () => {
      await expect(service.create({ name: 'My Engine', providerType: 'CUSTOM' } as any)).rejects.toThrow(
        'A valid endpoint URL is required for this provider type'
      );
    });

    it('resolves a LITELLM endpoint from the gateway env var when not explicitly provided', async () => {
      const spy = vi.spyOn(env as any, 'LITELLM_GATEWAY_URL', 'get').mockReturnValue('https://gateway.example.com');
      try {
        await service.create({ name: 'LiteLLM', providerType: 'LITELLM' } as any);
        const data = db.transcriptionModel.create.mock.calls[0][0].data;
        expect(data.endpointUrl).toBe('https://gateway.example.com');
      } finally {
        spy.mockRestore();
      }
    });

    it('throws for LITELLM when neither credentials.gatewayUrl nor the env var is set', async () => {
      const spy = vi.spyOn(env as any, 'LITELLM_GATEWAY_URL', 'get').mockReturnValue(undefined);
      try {
        await expect(service.create({ name: 'LiteLLM', providerType: 'LITELLM' } as any)).rejects.toThrow(
          'LiteLLM gateway is not configured'
        );
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('update', () => {
    it('returns null when the model does not belong to the tenant', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue(null);
      const result = await service.update('missing', { name: 'New Name' });
      expect(result).toBeNull();
      expect(db.transcriptionModel.update).not.toHaveBeenCalled();
    });

    it('falls back to existing values for fields not included in the update', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue({
        id: 'model-1', name: 'Old Name', providerType: 'CUSTOM', contract: 'custom',
        endpointUrl: 'https://old.example.com', credentials: null, region: null, modelId: null,
        models: null, config: null, status: 'active', isDefault: false,
        createdAt: new Date(), updatedAt: new Date(),
      });
      await service.update('model-1', { region: 'us-east-1' });
      const data = db.transcriptionModel.update.mock.calls[0][0].data;
      expect(data.name).toBe('Old Name');
      expect(data.endpointUrl).toBe('https://old.example.com');
      expect(data.region).toBe('us-east-1');
    });

    it('only re-encrypts credentials when new ones are actually provided', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue({
        id: 'model-1', name: 'Old Name', providerType: 'CUSTOM', contract: 'custom',
        endpointUrl: 'https://old.example.com', credentials: 'previously-encrypted-blob', region: null,
        modelId: null, models: null, config: null, status: 'active', isDefault: false,
        createdAt: new Date(), updatedAt: new Date(),
      });
      await service.update('model-1', {});
      expect(db.transcriptionModel.update.mock.calls[0][0].data.credentials).toBe('previously-encrypted-blob');
    });
  });

  describe('delete', () => {
    it('returns null when the model does not belong to the tenant', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue(null);
      expect(await service.delete('missing')).toBeNull();
      expect(db.transcriptionModel.delete).not.toHaveBeenCalled();
    });

    it('deletes and returns the id when found', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue({ id: 'model-1' });
      expect(await service.delete('model-1')).toEqual({ id: 'model-1' });
      expect(db.transcriptionModel.delete).toHaveBeenCalledWith({ where: { id: 'model-1' } });
    });
  });

  describe('setDefault', () => {
    it('returns null when the model does not belong to the tenant', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue(null);
      expect(await service.setDefault('missing')).toBeNull();
    });

    it('clears the previous default before setting the new one', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue({ id: 'model-1' });
      await service.setDefault('model-1');
      expect(db.transcriptionModel.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', isDefault: true },
        data: { isDefault: false },
      });
      expect(db.transcriptionModel.update).toHaveBeenCalledWith({ where: { id: 'model-1' }, data: { isDefault: true } });
    });
  });

  describe('validateAndDiscoverModels', () => {
    it('reports success with no models for CUSTOM providers, without invoking discover', async () => {
      const discover = vi.fn();
      const result = await service.validateAndDiscoverModels({ providerType: 'CUSTOM' } as any, discover);
      expect(result).toEqual({ success: true, models: [] });
      expect(discover).not.toHaveBeenCalled();
    });

    it('delegates to the injected discover fn for non-CUSTOM providers', async () => {
      const discover = vi.fn().mockResolvedValue([{ id: 'whisper-large', name: 'Whisper Large', capabilities: ['transcription'] }]);
      const result = await service.validateAndDiscoverModels(
        { providerType: 'OPENAI_COMPATIBLE', credentials: { apiKey: 'k' }, region: 'us-east-1' } as any,
        discover
      );
      expect(discover).toHaveBeenCalledWith('OPENAI_COMPATIBLE', { apiKey: 'k' }, 'us-east-1');
      expect(result.models).toHaveLength(1);
    });
  });

  describe('refreshModels', () => {
    it('returns null when the model does not belong to the tenant', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue(null);
      expect(await service.refreshModels('missing', vi.fn())).toBeNull();
    });

    it('returns the model unchanged for CUSTOM providers, without calling discover', async () => {
      const existing = {
        id: 'model-1', name: 'Custom', providerType: 'CUSTOM', contract: 'custom', endpointUrl: 'https://e.com',
        credentials: null, region: null, modelId: null, models: null, config: null, status: 'active',
        isDefault: false, createdAt: new Date(), updatedAt: new Date(),
      };
      db.transcriptionModel.findFirst.mockResolvedValue(existing);
      const discover = vi.fn();
      const result = await service.refreshModels('model-1', discover);
      expect(discover).not.toHaveBeenCalled();
      expect(result?.id).toBe('model-1');
    });

    it('decrypts stored credentials, calls discover, and persists the discovered models', async () => {
      const encrypted = service['encryption'].encrypt(JSON.stringify({ apiKey: 'stored-key' }));
      db.transcriptionModel.findFirst.mockResolvedValue({
        id: 'model-1', name: 'Scanner', providerType: 'OPENAI_COMPATIBLE', contract: 'openai-audio',
        endpointUrl: 'https://e.com', credentials: encrypted, region: 'us-east-1', modelId: null,
        models: null, config: null, status: 'active', isDefault: false, createdAt: new Date(), updatedAt: new Date(),
      });
      const discover = vi.fn().mockResolvedValue([{ id: 'm1', name: 'Model 1', capabilities: [] }]);

      await service.refreshModels('model-1', discover);

      expect(discover).toHaveBeenCalledWith('OPENAI_COMPATIBLE', { apiKey: 'stored-key' }, 'us-east-1');
      expect(db.transcriptionModel.update).toHaveBeenCalledWith({
        where: { id: 'model-1' },
        data: { models: { models: [{ id: 'm1', name: 'Model 1', capabilities: [] }] } },
      });
    });

    it('resolves LITELLM discovery credentials from gatewayUrl/masterKey instead of raw stored creds', async () => {
      const encrypted = service['encryption'].encrypt(JSON.stringify({ gatewayUrl: 'https://gw.example.com', masterKey: 'master-key-value' }));
      db.transcriptionModel.findFirst.mockResolvedValue({
        id: 'model-1', name: 'LiteLLM', providerType: 'LITELLM', contract: 'openai-audio', endpointUrl: 'https://gw.example.com',
        credentials: encrypted, region: null, modelId: null, models: null, config: null, status: 'active',
        isDefault: false, createdAt: new Date(), updatedAt: new Date(),
      });
      const discover = vi.fn().mockResolvedValue([]);

      await service.refreshModels('model-1', discover);

      expect(discover).toHaveBeenCalledWith('LITELLM', { baseUrl: 'https://gw.example.com', apiKey: 'master-key-value' }, undefined);
    });
  });

  describe('getConfig', () => {
    it('returns null when no model can be resolved', async () => {
      const result = await service.getConfig();
      expect(result).toBeNull();
    });

    it('falls back to the tenant default when no modelId is given', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue({
        id: 'default-model', providerType: 'CUSTOM', contract: 'custom', endpointUrl: 'https://e.com',
        credentials: null, region: null, modelId: 'whisper', activeVersionId: null,
      });
      const config = await service.getConfig();
      expect(db.transcriptionModel.findFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1', isDefault: true } });
      expect(config?.id).toBe('default-model');
    });

    it('applies a published version snapshot over the live config when versionId resolves', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue({
        id: 'model-1', providerType: 'CUSTOM', contract: 'custom', endpointUrl: 'https://live.example.com',
        credentials: null, region: null, modelId: 'live-model', activeVersionId: null,
      });
      db.transcriptionModelVersion.findFirst.mockResolvedValue({
        id: 'v-1', modelId: 'model-1',
        config: { endpointUrl: 'https://snapshot.example.com', modelId: 'snapshot-model' },
      });

      const config = await service.getConfig('model-1', 'v-1');

      expect(config?.endpointUrl).toBe('https://snapshot.example.com');
      expect(config?.modelId).toBe('snapshot-model');
      expect(config?.resolvedVersionId).toBe('v-1');
    });

    it('falls back to the live config when the requested version is not found', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue({
        id: 'model-1', providerType: 'CUSTOM', contract: 'custom', endpointUrl: 'https://live.example.com',
        credentials: null, region: null, modelId: 'live-model', activeVersionId: null,
      });
      db.transcriptionModelVersion.findFirst.mockResolvedValue(null);

      const config = await service.getConfig('model-1', 'missing-version');

      expect(config?.endpointUrl).toBe('https://live.example.com');
      expect(config?.resolvedVersionId).toBe('missing-version');
    });

    it('resolves the LITELLM master key with an apiKey/masterKey/env fallback chain', async () => {
      const encrypted = service['encryption'].encrypt(JSON.stringify({}));
      db.transcriptionModel.findFirst.mockResolvedValue({
        id: 'model-1', providerType: 'LITELLM', contract: 'openai-audio', endpointUrl: 'https://gw.example.com',
        credentials: encrypted, region: null, modelId: null, activeVersionId: null,
      });
      const spy = vi.spyOn(env as any, 'LITELLM_MASTER_KEY', 'get').mockReturnValue('env-master-key');
      try {
        const config = await service.getConfig('model-1');
        expect(config?.credentials).toEqual({ apiKey: 'env-master-key' });
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('toResponse (via findById)', () => {
    it('reports credentialsConfigured true with a masked hint when a secret-like value is stored', async () => {
      const encrypted = service['encryption'].encrypt(JSON.stringify({ apiKey: 'sk-verysecretvalue' }));
      db.transcriptionModel.findFirst.mockResolvedValue({
        id: 'model-1', tenantId: 'tenant-1', name: 'Engine', providerType: 'CUSTOM', contract: 'custom',
        endpointUrl: 'https://e.com', credentials: encrypted, region: null, modelId: null, models: null,
        config: null, activeVersionId: null, status: 'active', isDefault: false, createdAt: new Date(), updatedAt: new Date(),
      });
      const response = await service.findById('model-1');
      expect(response?.credentialsConfigured).toBe(true);
      expect(response?.credentialsHint).toBe('sk-...lue');
    });

    it('reports credentialsConfigured false when no credentials are stored', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue({
        id: 'model-1', tenantId: 'tenant-1', name: 'Engine', providerType: 'CUSTOM', contract: 'custom',
        endpointUrl: 'https://e.com', credentials: null, region: null, modelId: null, models: null,
        config: null, activeVersionId: null, status: 'active', isDefault: false, createdAt: new Date(), updatedAt: new Date(),
      });
      const response = await service.findById('model-1');
      expect(response?.credentialsConfigured).toBe(false);
      expect(response?.credentialsHint).toBeNull();
    });

    it('returns null when the model is not found', async () => {
      db.transcriptionModel.findFirst.mockResolvedValue(null);
      expect(await service.findById('missing')).toBeNull();
    });
  });
});

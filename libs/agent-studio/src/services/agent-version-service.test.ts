import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentVersionService } from './agent-version-service';
import type { AgentVersionDb } from './agent-version-service';

// ─── Mock db ──────────────────────────────────────────────────────────────────

const mockAgentVersion = {
  create: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
};

const mockDb: AgentVersionDb = { agentVersion: mockAgentVersion };

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const versionRow = {
  id: 'ver-1',
  agentId: 'agent-1',
  version: 1,
  status: 'draft',
  config: { type: 'llm', model: 'test-model' },
};

const simpleConfig = {
  type: 'llm' as const,
  model: 'test-model',
  systemPrompt: 'You are helpful.',
};

describe('AgentVersionService', () => {
  let service: AgentVersionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentVersionService(mockDb);
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a version with draft status and incremented version number', async () => {
      mockAgentVersion.count.mockResolvedValue(0);
      mockAgentVersion.create.mockResolvedValue(versionRow);

      const result = await service.create('agent-1', simpleConfig);

      expect(mockAgentVersion.count).toHaveBeenCalledWith({ where: { agentId: 'agent-1' } });
      const callArg = mockAgentVersion.create.mock.calls[0][0];
      expect(callArg.data.version).toBe(1); // 0 existing + 1
      expect(callArg.data.status).toBe('draft');
      expect(callArg.data.agentId).toBe('agent-1');
      expect(result).toEqual(versionRow);
    });

    it('increments version number based on existing count', async () => {
      mockAgentVersion.count.mockResolvedValue(3);
      mockAgentVersion.create.mockResolvedValue({ ...versionRow, version: 4 });

      await service.create('agent-1', simpleConfig);

      const callArg = mockAgentVersion.create.mock.calls[0][0];
      expect(callArg.data.version).toBe(4);
    });
  });

  // ─── findById ──────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('queries by id', async () => {
      mockAgentVersion.findFirst.mockResolvedValue(versionRow);

      const result = await service.findById('ver-1');

      expect(mockAgentVersion.findFirst).toHaveBeenCalledWith({ where: { id: 'ver-1' } });
      expect(result).toEqual(versionRow);
    });

    it('returns null when not found', async () => {
      mockAgentVersion.findFirst.mockResolvedValue(null);
      const result = await service.findById('missing');
      expect(result).toBeNull();
    });
  });

  // ─── findByAgentId ─────────────────────────────────────────────────────────

  describe('findByAgentId', () => {
    it('returns versions ordered by version desc', async () => {
      const rows = [
        { ...versionRow, version: 2 },
        { ...versionRow, version: 1 },
      ];
      mockAgentVersion.findMany.mockResolvedValue(rows);

      const result = await service.findByAgentId('agent-1');

      expect(mockAgentVersion.findMany).toHaveBeenCalledWith({
        where: { agentId: 'agent-1' },
        orderBy: { version: 'desc' },
      });
      expect(result).toHaveLength(2);
    });
  });

  // ─── publish ───────────────────────────────────────────────────────────────

  describe('publish', () => {
    it('sets status to published', async () => {
      mockAgentVersion.update.mockResolvedValue({ ...versionRow, status: 'published' });

      await service.publish('ver-1');

      expect(mockAgentVersion.update).toHaveBeenCalledWith({
        where: { id: 'ver-1' },
        data: { status: 'published' },
      });
    });
  });

  // ─── archive ───────────────────────────────────────────────────────────────

  describe('archive', () => {
    it('sets status to archived', async () => {
      mockAgentVersion.update.mockResolvedValue({ ...versionRow, status: 'archived' });

      await service.archive('ver-1');

      expect(mockAgentVersion.update).toHaveBeenCalledWith({
        where: { id: 'ver-1' },
        data: { status: 'archived' },
      });
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService } from './agent-service';
import type { AgentDb } from './agent-service';

// ─── Mock db ──────────────────────────────────────────────────────────────────

const mockAgent = {
  create: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  count: vi.fn(),
};

const mockDb: AgentDb = { agent: mockAgent };

const TENANT = 'tenant-1';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const agentRow = {
  id: 'agent-1',
  tenantId: TENANT,
  name: 'My Agent',
  description: null,
  type: 'simple',
  status: 'draft',
  config: { type: 'llm', model: 'test-model' },
};

describe('AgentService', () => {
  let service: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentService(TENANT, mockDb);
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates an agent with draft status', async () => {
      mockAgent.create.mockResolvedValue(agentRow);

      const result = await service.create({
        tenantId: TENANT,
        name: 'My Agent',
        type: 'simple',
        config: { type: 'llm', model: 'test-model', systemPrompt: '', tools: [] },
      });

      expect(mockAgent.create).toHaveBeenCalledOnce();
      const callArg = mockAgent.create.mock.calls[0][0];
      expect(callArg.data.tenantId).toBe(TENANT);
      expect(callArg.data.status).toBe('draft');
      expect(result).toEqual(agentRow);
    });

    it('passes description when provided', async () => {
      mockAgent.create.mockResolvedValue({ ...agentRow, description: 'desc' });

      await service.create({
        tenantId: TENANT,
        name: 'My Agent',
        description: 'desc',
        type: 'simple',
        config: { type: 'llm', model: 'test-model', systemPrompt: '' },
      });

      const callArg = mockAgent.create.mock.calls[0][0];
      expect(callArg.data.description).toBe('desc');
    });
  });

  // ─── findById ──────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('queries by id and tenantId', async () => {
      mockAgent.findFirst.mockResolvedValue(agentRow);

      const result = await service.findById('agent-1');

      expect(mockAgent.findFirst).toHaveBeenCalledWith({
        where: { id: 'agent-1', tenantId: TENANT },
      });
      expect(result).toEqual(agentRow);
    });

    it('returns null when not found', async () => {
      mockAgent.findFirst.mockResolvedValue(null);
      const result = await service.findById('missing');
      expect(result).toBeNull();
    });
  });

  // ─── findMany ──────────────────────────────────────────────────────────────

  describe('findMany', () => {
    it('returns paginated results with defaults', async () => {
      mockAgent.findMany.mockResolvedValue([agentRow]);
      mockAgent.count.mockResolvedValue(1);

      const result = await service.findMany();

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('applies status filter', async () => {
      mockAgent.findMany.mockResolvedValue([]);
      mockAgent.count.mockResolvedValue(0);

      await service.findMany({ status: 'active' });

      const callArg = mockAgent.findMany.mock.calls[0][0];
      expect(callArg.where.status).toBe('active');
    });

    it('applies type filter', async () => {
      mockAgent.findMany.mockResolvedValue([]);
      mockAgent.count.mockResolvedValue(0);

      await service.findMany({ type: 'graph' });

      const callArg = mockAgent.findMany.mock.calls[0][0];
      expect(callArg.where.type).toBe('graph');
    });

    it('applies search filter as OR clause', async () => {
      mockAgent.findMany.mockResolvedValue([]);
      mockAgent.count.mockResolvedValue(0);

      await service.findMany({ search: 'hello' });

      const callArg = mockAgent.findMany.mock.calls[0][0];
      expect(callArg.where.OR).toBeDefined();
      expect(callArg.where.OR).toHaveLength(2);
    });

    it('calculates skip from page and pageSize', async () => {
      mockAgent.findMany.mockResolvedValue([]);
      mockAgent.count.mockResolvedValue(0);

      await service.findMany({ page: 3, pageSize: 10 });

      const callArg = mockAgent.findMany.mock.calls[0][0];
      expect(callArg.skip).toBe(20); // (3-1) * 10
      expect(callArg.take).toBe(10);
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates only provided fields', async () => {
      mockAgent.update.mockResolvedValue({ ...agentRow, name: 'Renamed' });

      const result = await service.update('agent-1', { name: 'Renamed' });

      const callArg = mockAgent.update.mock.calls[0][0];
      expect(callArg.where).toEqual({ id: 'agent-1', tenantId: TENANT });
      expect(callArg.data.name).toBe('Renamed');
      expect(callArg.data.status).toBeUndefined();
      expect((result as typeof agentRow).name).toBe('Renamed');
    });

    it('does not include undefined fields in data', async () => {
      mockAgent.update.mockResolvedValue(agentRow);

      await service.update('agent-1', { status: 'active' });

      const callArg = mockAgent.update.mock.calls[0][0];
      expect(Object.keys(callArg.data)).toEqual(['status']);
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes by id and tenantId', async () => {
      mockAgent.delete.mockResolvedValue(agentRow);

      await service.delete('agent-1');

      expect(mockAgent.delete).toHaveBeenCalledWith({
        where: { id: 'agent-1', tenantId: TENANT },
      });
    });
  });

  // ─── updateStatus ──────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('delegates to update with only status', async () => {
      mockAgent.update.mockResolvedValue({ ...agentRow, status: 'active' });

      await service.updateStatus('agent-1', 'active');

      const callArg = mockAgent.update.mock.calls[0][0];
      expect(callArg.data).toEqual({ status: 'active' });
    });
  });
});

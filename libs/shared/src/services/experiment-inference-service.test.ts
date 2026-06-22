import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExperimentInferenceService } from './experiment-inference-service';
import { streamChat } from '@chatbot/ai';

vi.mock('@chatbot/ai', () => ({
  streamChat: vi.fn(),
}));

const mockedStreamChat = vi.mocked(streamChat);

const mockDb = {
  agent: { findFirst: vi.fn() },
  agentVersion: { findFirst: vi.fn() },
  apiKey: { findFirst: vi.fn() },
  inferenceSession: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  inferenceSessionMessage: { create: vi.fn() },
};

const mockProvider = {} as any;

describe('ExperimentInferenceService', () => {
  let service: ExperimentInferenceService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ExperimentInferenceService(mockDb as any);
  });

  it('throws when agent version does not resolve', async () => {
    mockDb.agentVersion.findFirst.mockResolvedValue(null);
    await expect(
      service.run({ tenantId: 't1', agentVersionId: 'v1', input: 'hi', provider: mockProvider, userId: 'u1' }),
    ).rejects.toThrow('Agent version not found');
  });

  it('throws when the version\'s agent does not belong to tenant', async () => {
    mockDb.agentVersion.findFirst.mockResolvedValue({ id: 'v1', agentId: 'a1', config: {} });
    mockDb.agent.findFirst.mockResolvedValue(null);
    await expect(
      service.run({ tenantId: 't1', agentVersionId: 'v1', input: 'hi', provider: mockProvider, userId: 'u1' }),
    ).rejects.toThrow('Agent not found');
  });

  it('throws when no API key exists for the agent', async () => {
    mockDb.agentVersion.findFirst.mockResolvedValue({ id: 'v1', agentId: 'a1', config: {} });
    mockDb.agent.findFirst.mockResolvedValue({ id: 'a1', type: 'simple' });
    mockDb.apiKey.findFirst.mockResolvedValue(null);
    await expect(
      service.run({ tenantId: 't1', agentVersionId: 'v1', input: 'hi', provider: mockProvider, userId: 'u1' }),
    ).rejects.toThrow('No API key found for agent');
  });

  it('runs the simple-agent path: creates a session, calls streamChat, ends the session', async () => {
    mockDb.agentVersion.findFirst.mockResolvedValue({
      id: 'v1',
      agentId: 'a1',
      config: { model: 'm1', systemPrompt: 'sys', temperature: 0.5, maxTokens: 100 },
    });
    mockDb.agent.findFirst.mockResolvedValue({ id: 'a1', type: 'simple' });
    mockDb.apiKey.findFirst.mockResolvedValue({ id: 'k1' });
    mockDb.inferenceSession.create.mockResolvedValue({ id: 's1' });
    mockDb.inferenceSessionMessage.create.mockResolvedValue({ id: 'm1' });
    mockDb.inferenceSession.updateMany.mockResolvedValue({ count: 1 });
    mockDb.inferenceSession.findFirst.mockResolvedValue({ id: 's1', status: 'ended' });
    mockedStreamChat.mockReturnValue({
      text: Promise.resolve('hello back'),
      usage: Promise.resolve({ totalTokens: 5 }),
    } as any);

    const result = await service.run({ tenantId: 't1', agentVersionId: 'v1', input: 'hi there', provider: mockProvider, userId: 'u1' });

    expect(mockDb.inferenceSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ apiKeyId: 'k1', tenantId: 't1', agentId: 'a1', agentVersionId: 'v1', channel: 'EXPERIMENT' }) }),
    );
    expect(mockedStreamChat).toHaveBeenCalledWith(
      expect.objectContaining({ provider: mockProvider, model: 'm1', system: 'sys', temperature: 0.5, maxOutputTokens: 100 }),
    );
    expect(result).toEqual(
      expect.objectContaining({ outputText: 'hello back', inferenceSessionId: 's1' }),
    );
  });

  it('runs the graph-agent path without touching the session service', async () => {
    mockDb.agentVersion.findFirst.mockResolvedValue({ id: 'v1', agentId: 'a1', config: { model: 'm1' } });
    mockDb.agent.findFirst.mockResolvedValue({ id: 'a1', type: 'graph' });
    mockDb.apiKey.findFirst.mockResolvedValue({ id: 'k1' });
    mockedStreamChat.mockReturnValue({
      text: Promise.resolve('graph reply'),
      usage: Promise.resolve({ totalTokens: 3 }),
    } as any);

    const result = await service.run({ tenantId: 't1', agentVersionId: 'v1', input: 'hi', provider: mockProvider, userId: 'u1' });

    expect(mockDb.inferenceSession.create).not.toHaveBeenCalled();
    expect(result.inferenceSessionId).toBe('');
    expect(result.outputText).toBe('graph reply');
  });

  it('extracts user text from varying input shapes', async () => {
    mockDb.agentVersion.findFirst.mockResolvedValue({ id: 'v1', agentId: 'a1', config: {} });
    mockDb.agent.findFirst.mockResolvedValue({ id: 'a1', type: 'graph' });
    mockDb.apiKey.findFirst.mockResolvedValue({ id: 'k1' });
    mockedStreamChat.mockReturnValue({ text: Promise.resolve('x'), usage: Promise.resolve({}) } as any);

    await service.run({ tenantId: 't1', agentVersionId: 'v1', input: { content: 'from content' }, provider: mockProvider, userId: 'u1' });
    expect(mockedStreamChat).toHaveBeenCalledWith(expect.objectContaining({ messages: [{ role: 'user', content: 'from content' }] }));

    await service.run({ tenantId: 't1', agentVersionId: 'v1', input: { q: 'from q' }, provider: mockProvider, userId: 'u1' });
    expect(mockedStreamChat).toHaveBeenCalledWith(expect.objectContaining({ messages: [{ role: 'user', content: 'from q' }] }));

    await service.run({ tenantId: 't1', agentVersionId: 'v1', input: { messages: [{ role: 'user', content: 'last user msg' }] }, provider: mockProvider, userId: 'u1' });
    expect(mockedStreamChat).toHaveBeenCalledWith(expect.objectContaining({ messages: [{ role: 'user', content: 'last user msg' }] }));

    await service.run({ tenantId: 't1', agentVersionId: 'v1', input: { weird: true }, provider: mockProvider, userId: 'u1' });
    expect(mockedStreamChat).toHaveBeenCalledWith(expect.objectContaining({ messages: [{ role: 'user', content: JSON.stringify({ weird: true }) }] }));
  });
});

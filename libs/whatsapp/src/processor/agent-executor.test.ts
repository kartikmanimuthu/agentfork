import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@chatbot/ai', async () => {
  const actual = await vi.importActual('@chatbot/ai');
  return {
    ...actual,
    createLLMProvider: vi.fn(() => ({})),
    streamChat: vi.fn(() => ({ text: Promise.resolve('AI reply') })),
    buildBuiltInTools: vi.fn(async () => ({})),
  };
});

vi.mock('@chatbot/shared', async () => {
  const actual = await vi.importActual('@chatbot/shared');
  return {
    ...actual,
    LlmProviderService: vi.fn(() => ({
      list: vi.fn(async () => []),
      getDefaultConfig: vi.fn(async () => ({ provider: 'bedrock', chatModel: 'claude-3' })),
    })),
    TenantConfigService: vi.fn(() => ({
      get: vi.fn(async () => null),
    })),
  };
});

vi.mock('@chatbot/agent-studio/server', () => ({
  buildMcpToolsForAgent: vi.fn(async () => ({ tools: {}, cleanup: vi.fn(async () => {}) })),
}));

vi.mock('@chatbot/knowledge-base', () => ({
  RetrievalService: vi.fn(() => ({
    query: vi.fn(async () => [{ content: 'KB chunk' }]),
  })),
}));

import { WhatsAppAgentExecutor } from './agent-executor';
import { streamChat, buildBuiltInTools } from '@chatbot/ai';
import { buildMcpToolsForAgent } from '@chatbot/agent-studio/server';

const mockPrisma = {
  agent: { findFirst: vi.fn() },
  agentKnowledgeBase: { findMany: vi.fn() },
};

const noopProviderFactory = vi.fn();

describe('WhatsAppAgentExecutor.executeSimpleAgent', () => {
  let executor: WhatsAppAgentExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new WhatsAppAgentExecutor(mockPrisma as any, noopProviderFactory as any);
  });

  it('returns LLM text for a simple agent', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'agent_1',
      type: 'simple',
      config: { model: 'claude-3', systemPrompt: 'You are helpful.', temperature: 0.7 },
    });
    mockPrisma.agentKnowledgeBase.findMany.mockResolvedValueOnce([]);

    const result = await executor.execute('agent_1', { text: 'Hello' }, { tenantId: 'tenant_1' });

    expect(result.text).toBe('AI reply');
    expect(streamChat).toHaveBeenCalledOnce();
  });

  it('injects KB context into the system prompt when KB is attached', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'agent_1',
      type: 'simple',
      config: { model: 'claude-3', systemPrompt: 'You are helpful.', temperature: 0.7 },
    });
    mockPrisma.agentKnowledgeBase.findMany.mockResolvedValueOnce([
      { knowledgeBase: { id: 'kb_1', name: 'Docs', status: 'active' } },
    ]);

    await executor.execute('agent_1', { text: 'What is X?' }, { tenantId: 'tenant_1' });

    const callArgs = vi.mocked(streamChat).mock.calls[0][0] as any;
    expect(callArgs.system).toContain('retrieved context');
    expect(callArgs.system).toContain('KB chunk');
  });

  it('passes MCP tools to streamChat when tools are available', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'agent_1',
      type: 'simple',
      config: { model: 'claude-3', systemPrompt: 'You are helpful.' },
    });
    mockPrisma.agentKnowledgeBase.findMany.mockResolvedValueOnce([]);
    vi.mocked(buildMcpToolsForAgent).mockResolvedValueOnce({
      tools: { myTool: { description: 'A tool', parameters: {}, execute: vi.fn() } } as any,
      cleanup: vi.fn(async () => {}),
    });

    await executor.execute('agent_1', { text: 'Use the tool' }, { tenantId: 'tenant_1' });

    const callArgs = vi.mocked(streamChat).mock.calls[0][0] as any;
    expect(callArgs.tools).toBeDefined();
    expect(callArgs.maxSteps).toBe(5);
  });

  it('calls streamChat without tools when none are attached', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'agent_1',
      type: 'simple',
      config: { model: 'claude-3', systemPrompt: 'You are helpful.' },
    });
    mockPrisma.agentKnowledgeBase.findMany.mockResolvedValueOnce([]);
    vi.mocked(buildMcpToolsForAgent).mockResolvedValueOnce({ tools: {}, cleanup: vi.fn(async () => {}) });
    vi.mocked(buildBuiltInTools).mockResolvedValueOnce({});

    await executor.execute('agent_1', { text: 'Hi' }, { tenantId: 'tenant_1' });

    const callArgs = vi.mocked(streamChat).mock.calls[0][0] as any;
    expect(callArgs.tools).toBeUndefined();
    expect(callArgs.maxSteps).toBeUndefined();
  });

  it('throws for unknown agent type', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce({ id: 'agent_1', type: 'unknown', config: {} });

    await expect(executor.execute('agent_1', { text: 'Hi' }, { tenantId: 'tenant_1' }))
      .rejects.toThrow('Unsupported agent type: unknown');
  });

  it('throws for agent not found', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce(null);

    await expect(executor.execute('missing_agent', { text: 'Hi' }, { tenantId: 'tenant_1' }))
      .rejects.toThrow('Agent not found: missing_agent');
  });

  it('dispatches to executeGraphAgent for graph agent type without throwing for type dispatch', async () => {
    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'agent_g',
      type: 'graph',
      config: {
        nodes: [{ id: 'n1', type: 'whatsapp_trigger' }, { id: 'n2', type: 'llm' }],
        edges: [{ source: 'n1', target: 'n2' }],
      },
    });

    // The graph executor is imported dynamically; since @chatbot/agent-studio/server is mocked
    // at module level without GraphExecutor, this will throw from the dynamic import path.
    // We verify only that the error is NOT "Unsupported agent type" — meaning dispatch worked.
    await expect(
      executor.execute('agent_g', { text: 'Hello' }, { tenantId: 'tenant_1' }),
    ).rejects.not.toThrow('Unsupported agent type: graph');
  });

  it('executes a graph agent using GraphExecutor and returns text from output channel', async () => {
    const mockExecuteFromState = vi.fn().mockResolvedValue({
      channels: { response: 'Hello from graph!' },
      messages: [],
      currentNodeId: null,
      metadata: { executionId: 'e1', agentId: 'graph_1', tenantId: 't1', userId: 'whatsapp', startedAt: new Date() },
    });

    const mockRegister = vi.fn();

    vi.doMock('@chatbot/agent-studio/server', () => ({
      GraphExecutor: vi.fn().mockImplementation(() => ({
        register: mockRegister,
        executeFromState: mockExecuteFromState,
      })),
      createNodeExecutors: vi.fn().mockReturnValue([]),
    }));

    mockPrisma.agent.findFirst.mockResolvedValueOnce({
      id: 'graph_1',
      type: 'graph',
      config: {
        nodes: [{ id: 'n1', type: 'whatsapp_trigger', config: { type: 'whatsapp_trigger' } }],
        edges: [],
      },
    });

    const result = await executor.execute(
      'graph_1',
      { text: 'Hi from WhatsApp' },
      {
        wa_sender_id: '919876543210',
        wa_phone_number_id: 'phone_123',
        wa_account_id: 'acc_1',
        wa_session_id: 'sess_1',
        wa_within_window: true,
        wa_message_type: 'text',
        wa_media_id: null,
        tenantId: 'tenant_1',
      },
    );

    expect(result.text).toBe('Hello from graph!');
    expect(mockExecuteFromState).toHaveBeenCalledOnce();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NodeExecutionContext, GraphState } from '../types';
import type { GraphNode } from '../../types/agent';
import { StateSchemaNodeExecutor } from './state-schema-executor';
import { RouterNodeExecutor } from './router-executor';
import { ToolNodeExecutor } from './tool-executor';
import { LlmNodeExecutor } from './llm-executor';
import { MemoryNodeExecutor } from './memory-executor';
import { OutputNodeExecutor } from './output-executor';
import { McpClientService } from '../../services/mcp-client.service';

vi.mock('../../services/mcp-client.service');

function createMockState(overrides: Partial<GraphState> = {}): GraphState {
  return {
    channels: {},
    messages: [],
    currentNodeId: null,
    metadata: {
      executionId: 'exec-1',
      agentId: 'agent-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      startedAt: new Date(),
    },
    ...overrides,
  };
}

function createMockNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'node-1',
    type: 'llm',
    label: 'Test Node',
    config: { type: 'llm', model: 'test-model' },
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function createMockContext(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  return {
    state: createMockState(),
    node: createMockNode(),
    config: { type: 'llm', model: 'test-model' },
    services: {
      llmProvider: vi.fn(),
      prisma: {},
    },
    emit: vi.fn(),
    ...overrides,
  };
}

describe('StateSchemaNodeExecutor', () => {
  const executor = new StateSchemaNodeExecutor();

  it('initializes channels from field definitions', async () => {
    const ctx = createMockContext({
      node: createMockNode({ id: 'schema-1', type: 'state_schema', label: 'Schema' }),
      config: {
        type: 'state_schema',
        fields: [
          { name: 'name', type: 'string' },
          { name: 'count', type: 'number' },
          { name: 'active', type: 'boolean' },
          { name: 'items', type: 'array' },
          { name: 'data', type: 'object' },
        ],
      },
    });

    const result = await executor.execute(ctx);

    expect(result.stateUpdates).toEqual({
      name: '',
      count: 0,
      active: false,
      items: [],
      data: {},
    });
    expect(result.trace.status).toBe('completed');
    expect(result.trace.nodeType).toBe('state_schema');
  });

  it('does not overwrite existing channel values', async () => {
    const ctx = createMockContext({
      state: createMockState({ channels: { name: 'existing', count: 42 } }),
      node: createMockNode({ id: 'schema-1', type: 'state_schema', label: 'Schema' }),
      config: {
        type: 'state_schema',
        fields: [
          { name: 'name', type: 'string' },
          { name: 'count', type: 'number' },
          { name: 'newField', type: 'boolean' },
        ],
      },
    });

    const result = await executor.execute(ctx);

    expect(result.stateUpdates).toEqual({ newField: false });
    expect(result.stateUpdates).not.toHaveProperty('name');
    expect(result.stateUpdates).not.toHaveProperty('count');
  });

  it('uses field default when provided', async () => {
    const ctx = createMockContext({
      node: createMockNode({ id: 'schema-1', type: 'state_schema', label: 'Schema' }),
      config: {
        type: 'state_schema',
        fields: [{ name: 'greeting', type: 'string', default: 'hello' }],
      },
    });

    const result = await executor.execute(ctx);

    expect(result.stateUpdates).toEqual({ greeting: 'hello' });
  });
});

describe('RouterNodeExecutor', () => {
  const executor = new RouterNodeExecutor();

  it('matches the first true condition', async () => {
    const ctx = createMockContext({
      state: createMockState({ channels: { score: 85 } }),
      node: createMockNode({ id: 'router-1', type: 'router', label: 'Router' }),
      config: {
        type: 'router',
        conditions: [
          { condition: 'score > 90', target: 'high-node' },
          { condition: 'score > 70', target: 'mid-node' },
          { condition: 'score > 50', target: 'low-node' },
        ],
      },
    });

    const result = await executor.execute(ctx);

    expect(result.next).toEqual(['mid-node']);
    expect(result.trace.output).toEqual({ matchedTarget: 'mid-node' });
  });

  it('falls back to defaultTarget when no condition matches', async () => {
    const ctx = createMockContext({
      state: createMockState({ channels: { score: 10 } }),
      node: createMockNode({ id: 'router-1', type: 'router', label: 'Router' }),
      config: {
        type: 'router',
        conditions: [{ condition: 'score > 50', target: 'high-node' }],
        defaultTarget: 'fallback-node',
      },
    });

    const result = await executor.execute(ctx);

    expect(result.next).toEqual(['fallback-node']);
  });

  it('throws when no condition matches and no default target', async () => {
    const ctx = createMockContext({
      state: createMockState({ channels: { score: 10 } }),
      node: createMockNode({ id: 'router-1', type: 'router', label: 'Router' }),
      config: {
        type: 'router',
        conditions: [{ condition: 'score > 50', target: 'high-node' }],
      },
    });

    await expect(executor.execute(ctx)).rejects.toThrow(
      'router node "router-1": no condition matched and no default target',
    );
  });

  it('handles invalid expressions gracefully', async () => {
    const ctx = createMockContext({
      state: createMockState({ channels: {} }),
      node: createMockNode({ id: 'router-1', type: 'router', label: 'Router' }),
      config: {
        type: 'router',
        conditions: [{ condition: '???invalid!!!', target: 'bad-node' }],
        defaultTarget: 'fallback-node',
      },
    });

    const result = await executor.execute(ctx);

    expect(result.next).toEqual(['fallback-node']);
  });
});

describe('ToolNodeExecutor', () => {
  const executor = new ToolNodeExecutor();

  it('returns empty result with tool_result channel', async () => {
    const ctx = createMockContext({
      node: createMockNode({ id: 'tool-1', type: 'tool', label: 'Tool' }),
      config: {
        type: 'tool',
        toolName: 'search',
        parameters: { query: 'test' },
      },
    });

    const result = await executor.execute(ctx);

    expect(result.stateUpdates).toEqual({ tool_result: null });
    expect(result.next).toBeNull();
    expect(result.trace.status).toBe('completed');
    expect(result.trace.input).toEqual({ toolName: 'search', parameters: { query: 'test' } });
  });
});

describe('LlmNodeExecutor', () => {
  const executor = new LlmNodeExecutor();

  it('streams text and returns full response', async () => {
    const chunks = ['Hello', ' ', 'world'];
    const mockProvider = {
      streamChat: vi.fn().mockReturnValue({
        textStream: (async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        })(),
      }),
    };

    const emit = vi.fn();
    const ctx = createMockContext({
      state: createMockState({
        messages: [{ role: 'user', content: 'Hi' }],
      }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3', systemPrompt: 'Be helpful', temperature: 0.7 },
      services: { llmProvider: vi.fn().mockResolvedValue(mockProvider), prisma: {} },
      emit,
    });

    const result = await executor.execute(ctx);

    expect(result.output).toBe('Hello world');
    expect(result.stateUpdates).toEqual({ response: 'Hello world' });
    expect(result.next).toBeNull();
    expect(result.trace.status).toBe('completed');
    expect(result.trace.input).toEqual({ messageCount: 1, model: 'claude-3' });
    expect(result.trace.output).toEqual({ responseLength: 11 });

    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenCalledWith({ type: 'text_delta', nodeId: 'llm-1', delta: 'Hello' });
    expect(emit).toHaveBeenCalledWith({ type: 'text_delta', nodeId: 'llm-1', delta: ' ' });
    expect(emit).toHaveBeenCalledWith({ type: 'text_delta', nodeId: 'llm-1', delta: 'world' });

    expect(mockProvider.streamChat).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'Hi' }],
      system: 'Be helpful',
      temperature: 0.7,
      maxOutputTokens: undefined,
    });
  });

  it('propagates provider errors', async () => {
    const ctx = createMockContext({
      state: createMockState({ messages: [{ role: 'user', content: 'Hi' }] }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3' },
      services: {
        llmProvider: vi.fn().mockRejectedValue(new Error('provider unavailable')),
        prisma: {},
      },
      emit: vi.fn(),
    });

    await expect(executor.execute(ctx)).rejects.toThrow('provider unavailable');
  });

  it('prepends context channel content to last user message as XML', async () => {
    const chunks = ['answer'];
    const mockProvider = {
      streamChat: vi.fn().mockReturnValue({
        textStream: (async function* () { for (const c of chunks) yield c; })(),
      }),
    };

    const ctx = createMockContext({
      state: createMockState({
        messages: [{ role: 'user', content: 'What is the policy?' }],
        channels: { kb_results: 'Policy document text here.' },
      }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3', contextChannels: ['kb_results'] },
      services: { llmProvider: vi.fn().mockResolvedValue(mockProvider), prisma: {} },
      emit: vi.fn(),
    });

    await executor.execute(ctx);

    expect(mockProvider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: 'user',
            content:
              '<documents>\n<document index="1">\nPolicy document text here.\n</document>\n</documents>\n\nWhat is the policy?',
          },
        ],
        system: undefined,
      }),
    );
  });

  it('skips injection when listed channel value is empty', async () => {
    const chunks = ['answer'];
    const mockProvider = {
      streamChat: vi.fn().mockReturnValue({
        textStream: (async function* () { for (const c of chunks) yield c; })(),
      }),
    };

    const ctx = createMockContext({
      state: createMockState({
        messages: [{ role: 'user', content: 'Hello' }],
        channels: { kb_results: '' },
      }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3', contextChannels: ['kb_results'] },
      services: { llmProvider: vi.fn().mockResolvedValue(mockProvider), prisma: {} },
      emit: vi.fn(),
    });

    await executor.execute(ctx);

    expect(mockProvider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    );
  });

  it('skips injection when no user message exists in messages array', async () => {
    const chunks = ['answer'];
    const mockProvider = {
      streamChat: vi.fn().mockReturnValue({
        textStream: (async function* () { for (const c of chunks) yield c; })(),
      }),
    };

    const ctx = createMockContext({
      state: createMockState({
        messages: [],
        channels: { kb_results: 'some context' },
      }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3', contextChannels: ['kb_results'] },
      services: { llmProvider: vi.fn().mockResolvedValue(mockProvider), prisma: {} },
      emit: vi.fn(),
    });

    await executor.execute(ctx);

    expect(mockProvider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [] }),
    );
  });

  it('injects multiple channels as separate document blocks', async () => {
    const chunks = ['answer'];
    const mockProvider = {
      streamChat: vi.fn().mockReturnValue({
        textStream: (async function* () { for (const c of chunks) yield c; })(),
      }),
    };

    const ctx = createMockContext({
      state: createMockState({
        messages: [{ role: 'user', content: 'Summarise.' }],
        channels: { kb_results: 'KB content.', http_data: 'HTTP content.' },
      }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: {
        type: 'llm',
        model: 'claude-3',
        contextChannels: ['kb_results', 'http_data'],
      },
      services: { llmProvider: vi.fn().mockResolvedValue(mockProvider), prisma: {} },
      emit: vi.fn(),
    });

    await executor.execute(ctx);

    expect(mockProvider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: 'user',
            content:
              '<documents>\n<document index="1">\nKB content.\n</document>\n<document index="2">\nHTTP content.\n</document>\n</documents>\n\nSummarise.',
          },
        ],
      }),
    );
  });

  it('skips injection when listed channel does not exist in channels state', async () => {
    const chunks = ['answer'];
    const mockProvider = {
      streamChat: vi.fn().mockReturnValue({
        textStream: (async function* () { for (const c of chunks) yield c; })(),
      }),
    };

    const ctx = createMockContext({
      state: createMockState({
        messages: [{ role: 'user', content: 'Hello' }],
        channels: {},
      }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3', contextChannels: ['nonexistent_channel'] },
      services: { llmProvider: vi.fn().mockResolvedValue(mockProvider), prisma: {} },
      emit: vi.fn(),
    });

    await executor.execute(ctx);

    expect(mockProvider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    );
  });

  it('skips injection when channel value is whitespace only', async () => {
    const chunks = ['answer'];
    const mockProvider = {
      streamChat: vi.fn().mockReturnValue({
        textStream: (async function* () { for (const c of chunks) yield c; })(),
      }),
    };

    const ctx = createMockContext({
      state: createMockState({
        messages: [{ role: 'user', content: 'Hello' }],
        channels: { kb_results: '   ' },
      }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3', contextChannels: ['kb_results'] },
      services: { llmProvider: vi.fn().mockResolvedValue(mockProvider), prisma: {} },
      emit: vi.fn(),
    });

    await executor.execute(ctx);

    expect(mockProvider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    );
  });

  it('injects context into last user message in a multi-turn conversation', async () => {
    const chunks = ['answer'];
    const mockProvider = {
      streamChat: vi.fn().mockReturnValue({
        textStream: (async function* () { for (const c of chunks) yield c; })(),
      }),
    };

    const ctx = createMockContext({
      state: createMockState({
        messages: [
          { role: 'user', content: 'First message.' },
          { role: 'assistant', content: 'First reply.' },
          { role: 'user', content: 'Second message.' },
        ],
        channels: { kb_results: 'KB context.' },
      }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3', contextChannels: ['kb_results'] },
      services: { llmProvider: vi.fn().mockResolvedValue(mockProvider), prisma: {} },
      emit: vi.fn(),
    });

    await executor.execute(ctx);

    expect(mockProvider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'user', content: 'First message.' },
          { role: 'assistant', content: 'First reply.' },
          {
            role: 'user',
            content:
              '<documents>\n<document index="1">\nKB context.\n</document>\n</documents>\n\nSecond message.',
          },
        ],
      }),
    );
  });
});

describe('RouterNodeExecutor — natural_language mode', () => {
  const executor = new RouterNodeExecutor();

  function makeNlContext(conditions: Array<{ condition: string; target: string }>, llmResponse: string) {
    const mockStreamChat = vi.fn().mockReturnValue({
      textStream: (async function* () { yield llmResponse; })(),
    });
    return createMockContext({
      node: createMockNode({ id: 'router-nl', type: 'router', label: 'NL Router' }),
      config: {
        type: 'router',
        mode: 'natural_language' as const,
        conditions,
      },
      services: {
        llmProvider: vi.fn().mockResolvedValue({ streamChat: mockStreamChat }),
        prisma: {},
      },
    });
  }

  it('calls llmProvider and routes to the matched condition', async () => {
    const ctx = makeNlContext(
      [
        { condition: 'user is asking about billing', target: 'billing-node' },
        { condition: 'user wants a refund', target: 'refund-node' },
      ],
      '0'
    );
    const result = await executor.execute(ctx);
    expect(result.next).toEqual(['billing-node']);
  });

  it('routes to second condition when LLM returns index 1', async () => {
    const ctx = makeNlContext(
      [
        { condition: 'user is asking about billing', target: 'billing-node' },
        { condition: 'user wants a refund', target: 'refund-node' },
      ],
      '1'
    );
    const result = await executor.execute(ctx);
    expect(result.next).toEqual(['refund-node']);
  });

  it('falls back to defaultTarget when LLM returns -1', async () => {
    const ctx = createMockContext({
      node: createMockNode({ id: 'router-nl', type: 'router', label: 'NL Router' }),
      config: {
        type: 'router',
        mode: 'natural_language' as const,
        conditions: [{ condition: 'user is asking about billing', target: 'billing-node' }],
        defaultTarget: 'fallback-node',
      },
      services: {
        llmProvider: vi.fn().mockResolvedValue({
          streamChat: vi.fn().mockReturnValue({
            textStream: (async function* () { yield '-1'; })(),
          }),
        }),
        prisma: {},
      },
    });
    const result = await executor.execute(ctx);
    expect(result.next).toEqual(['fallback-node']);
  });

  it('throws when LLM returns -1 and no defaultTarget', async () => {
    const ctx = makeNlContext(
      [{ condition: 'user is asking about billing', target: 'billing-node' }],
      '-1'
    );
    await expect(executor.execute(ctx)).rejects.toThrow('no condition matched');
  });

  it('includes channel state in the classification prompt', async () => {
    const mockStreamChat = vi.fn().mockReturnValue({
      textStream: (async function* () { yield '0'; })(),
    });
    const llmProvider = vi.fn().mockResolvedValue({ streamChat: mockStreamChat });
    const ctx = createMockContext({
      state: createMockState({ channels: { query: 'I need a refund' } }),
      node: createMockNode({ id: 'router-nl', type: 'router', label: 'NL Router' }),
      config: {
        type: 'router',
        mode: 'natural_language' as const,
        conditions: [{ condition: 'user wants a refund', target: 'refund-node' }],
      },
      services: { llmProvider, prisma: {} },
    });
    await executor.execute(ctx);
    const callArgs = mockStreamChat.mock.calls[0][0];
    const promptText = JSON.stringify(callArgs.messages);
    expect(promptText).toContain('I need a refund');
  });

  it('propagates error when llmProvider rejects', async () => {
    const mockStreamChat = vi.fn().mockReturnValue({
      textStream: (async function* () { yield '0'; })(),
    });
    const llmProvider = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    const ctx = createMockContext({
      node: createMockNode({ id: 'router-nl', type: 'router', label: 'NL Router' }),
      config: {
        type: 'router',
        mode: 'natural_language',
        conditions: [{ condition: 'user is asking about billing', target: 'billing-node' }],
      },
      services: { llmProvider, prisma: {} },
    });
    await expect(executor.execute(ctx)).rejects.toThrow('provider unavailable');
  });
});

describe('MemoryNodeExecutor — summary strategy', () => {
  const executor = new MemoryNodeExecutor();

  const baseMessages = [
    { role: 'user' as const, content: 'Hello' },
    { role: 'assistant' as const, content: 'Hi there' },
    { role: 'user' as const, content: 'What is 2+2?' },
    { role: 'assistant' as const, content: '4' },
    { role: 'user' as const, content: 'Tell me about Paris' },
    { role: 'assistant' as const, content: 'Paris is the capital of France' },
    { role: 'user' as const, content: 'What about London?' },
    { role: 'assistant' as const, content: 'London is the capital of the UK' },
  ];

  function makeCtx(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    keepRecent: number,
    llmResponse: string,
  ) {
    const mockStreamChat = vi.fn().mockReturnValue({
      textStream: (async function* () { yield llmResponse; })(),
    });
    return createMockContext({
      node: createMockNode({ id: 'memory-1', type: 'memory', label: 'Memory' }),
      config: {
        type: 'memory',
        strategy: 'summary',
        messagesChannel: 'messages',
        keepRecent,
      },
      state: createMockState({ channels: { messages } }),
      services: {
        llmProvider: vi.fn().mockResolvedValue({ streamChat: mockStreamChat }),
        prisma: {},
      },
    });
  }

  it('returns messages unchanged when count <= keepRecent (no LLM call)', async () => {
    const messages = baseMessages.slice(0, 4); // 4 messages
    const mockStreamChat = vi.fn();
    const llmProvider = vi.fn().mockResolvedValue({ streamChat: mockStreamChat });
    const ctx = createMockContext({
      node: createMockNode({ id: 'memory-1', type: 'memory', label: 'Memory' }),
      config: { type: 'memory', strategy: 'summary', messagesChannel: 'messages', keepRecent: 6 },
      state: createMockState({ channels: { messages } }),
      services: { llmProvider, prisma: {} },
    });
    const result = await executor.execute(ctx);
    expect(result.stateUpdates.messages).toEqual(messages);
    expect(llmProvider).not.toHaveBeenCalled();
  });

  it('calls llmProvider and prepends summary when count > keepRecent', async () => {
    const ctx = makeCtx(baseMessages, 4, 'User asked about math and cities.');
    const result = await executor.execute(ctx);
    const updated = result.stateUpdates.messages as Array<{ role: string; content: string }>;
    // First message should be the summary
    expect(updated[0].role).toBe('system');
    expect(updated[0].content).toContain('User asked about math and cities.');
    // Last 4 messages preserved verbatim
    expect(updated.slice(1)).toEqual(baseMessages.slice(-4));
  });

  it('summary system message contains the correct prefix', async () => {
    const ctx = makeCtx(baseMessages, 4, 'A summary of the chat.');
    const result = await executor.execute(ctx);
    const updated = result.stateUpdates.messages as Array<{ role: string; content: string }>;
    expect(updated[0].content).toBe('Summary of earlier conversation:\nA summary of the chat.');
  });

  it('includes older messages in the LLM summarization prompt', async () => {
    const mockStreamChat = vi.fn().mockReturnValue({
      textStream: (async function* () { yield 'summary'; })(),
    });
    const llmProvider = vi.fn().mockResolvedValue({ streamChat: mockStreamChat });
    const ctx = createMockContext({
      node: createMockNode({ id: 'memory-1', type: 'memory', label: 'Memory' }),
      config: { type: 'memory', strategy: 'summary', messagesChannel: 'messages', keepRecent: 4 },
      state: createMockState({ channels: { messages: baseMessages } }),
      services: { llmProvider, prisma: {} },
    });
    await executor.execute(ctx);
    const callArgs = mockStreamChat.mock.calls[0][0];
    const promptText = JSON.stringify(callArgs.messages);
    // Older messages (first 4) should be in the prompt
    expect(promptText).toContain('Hello');
    expect(promptText).toContain('What is 2+2?');
    // Recent messages (last 4) should NOT be in the prompt
    expect(promptText).not.toContain('What about London?');
  });

  it('propagates error when llmProvider rejects', async () => {
    const llmProvider = vi.fn().mockRejectedValue(new Error('provider down'));
    const ctx = createMockContext({
      node: createMockNode({ id: 'memory-1', type: 'memory', label: 'Memory' }),
      config: { type: 'memory', strategy: 'summary', messagesChannel: 'messages', keepRecent: 2 },
      state: createMockState({ channels: { messages: baseMessages } }),
      services: { llmProvider, prisma: {} },
    });
    await expect(executor.execute(ctx)).rejects.toThrow('provider down');
  });
});

describe('OutputNodeExecutor', () => {
  const executor = new OutputNodeExecutor();

  function makeCtx(
    format: 'text' | 'json' | 'stream',
    channelValue: unknown,
  ) {
    const emit = vi.fn();
    const ctx = createMockContext({
      node: createMockNode({ id: 'out-1', type: 'output', label: 'Output' }),
      config: { type: 'output', responseChannel: 'response', format },
      state: createMockState({ channels: { response: channelValue } }),
      emit,
    });
    return { ctx, emit };
  }

  describe('text format', () => {
    it('returns string channel value as-is', async () => {
      const { ctx } = makeCtx('text', 'hello world');
      const result = await executor.execute(ctx);
      expect(result.output).toBe('hello world');
      expect(result.stateUpdates.__output).toBe('hello world');
    });

    it('coerces object channel value to JSON string', async () => {
      const { ctx } = makeCtx('text', { foo: 'bar' });
      const result = await executor.execute(ctx);
      expect(result.output).toBe('{"foo":"bar"}');
    });

    it('does not emit text_delta events', async () => {
      const { ctx, emit } = makeCtx('text', 'hello');
      await executor.execute(ctx);
      expect(emit).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'text_delta' }),
      );
    });

    it('returns empty string for null/undefined channel value', async () => {
      const { ctx } = makeCtx('text', undefined);
      const result = await executor.execute(ctx);
      expect(result.output).toBe('');
    });
  });

  describe('json format', () => {
    it('serializes object channel value as JSON string', async () => {
      const { ctx } = makeCtx('json', { score: 0.9, label: 'positive' });
      const result = await executor.execute(ctx);
      expect(result.output).toBe(JSON.stringify({ score: 0.9, label: 'positive' }));
    });

    it('serializes a string channel value as JSON (quoted)', async () => {
      const { ctx } = makeCtx('json', 'hello');
      const result = await executor.execute(ctx);
      expect(result.output).toBe('"hello"');
    });

    it('serializes null/undefined channel value as JSON null', async () => {
      const { ctx } = makeCtx('json', undefined);
      const result = await executor.execute(ctx);
      expect(result.output).toBe('null');
    });

    it('throws when channel value is not JSON-serializable (circular ref)', async () => {
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;
      const { ctx } = makeCtx('json', circular);
      await expect(executor.execute(ctx)).rejects.toThrow(TypeError);
    });
  });

  describe('stream format', () => {
    it('returns the string content as output', async () => {
      const { ctx } = makeCtx('stream', 'streamed content');
      const result = await executor.execute(ctx);
      expect(result.output).toBe('streamed content');
      expect(result.stateUpdates.__output).toBe('streamed content');
    });

    it('emits a text_delta event with the full content', async () => {
      const { ctx, emit } = makeCtx('stream', 'streamed content');
      await executor.execute(ctx);
      expect(emit).toHaveBeenCalledWith({
        type: 'text_delta',
        nodeId: 'out-1',
        delta: 'streamed content',
      });
    });

    it('coerces non-string channel value to string before emitting', async () => {
      const { ctx, emit } = makeCtx('stream', { answer: 42 });
      await executor.execute(ctx);
      expect(emit).toHaveBeenCalledWith({
        type: 'text_delta',
        nodeId: 'out-1',
        delta: '{"answer":42}',
      });
    });
  });

  describe('trace', () => {
    it('includes format and responseChannel in trace input', async () => {
      const { ctx } = makeCtx('text', 'hi');
      const result = await executor.execute(ctx);
      expect(result.trace.input).toEqual({ responseChannel: 'response', format: 'text' });
    });

    it('includes contentLength in trace output', async () => {
      const { ctx } = makeCtx('text', 'hi');
      const result = await executor.execute(ctx);
      expect(result.trace.output).toEqual({ contentLength: 2 });
    });
  });
});

// ── LlmNodeExecutor — MCP tool integration ────────────────────────────────────

const MOCK_MCP_SERVER = {
  id: 'srv-1',
  name: 'test-server',
  status: 'active',
  config: { transport: 'sse', transportConfig: { transport: 'sse', endpoint: 'http://localhost:4000' } },
};

const TWO_MCP_TOOLS = [
  { name: 'tool_a', description: 'Tool A', inputSchema: { type: 'object', properties: {} } },
  { name: 'tool_b', description: 'Tool B', inputSchema: { type: 'object', properties: {} } },
];

describe('LlmNodeExecutor — MCP tool integration', () => {
  const executor = new LlmNodeExecutor();

  let mockConnect: ReturnType<typeof vi.fn>;
  let mockDiscoverTools: ReturnType<typeof vi.fn>;
  let mockExecuteTool: ReturnType<typeof vi.fn>;
  let mockDisconnect: ReturnType<typeof vi.fn>;
  let mockStreamChat: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockConnect = vi.fn().mockResolvedValue(undefined);
    mockDiscoverTools = vi.fn().mockResolvedValue(TWO_MCP_TOOLS);
    mockExecuteTool = vi.fn().mockResolvedValue('tool result');
    mockDisconnect = vi.fn().mockResolvedValue(undefined);
    vi.mocked(McpClientService).mockImplementation(() => ({
      connect: mockConnect,
      discoverTools: mockDiscoverTools,
      executeTool: mockExecuteTool,
      disconnect: mockDisconnect,
    } as any));

    mockStreamChat = vi.fn().mockReturnValue({
      textStream: (async function* () { yield 'answer'; })(),
    });
  });

  afterEach(() => vi.clearAllMocks());

  function makeLlmCtx(mcpServerIds: string[], prismaServer: object | null = MOCK_MCP_SERVER) {
    return createMockContext({
      state: createMockState({ messages: [{ role: 'user', content: 'Hello' }] }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3', mcpServerIds },
      services: {
        llmProvider: vi.fn().mockResolvedValue({ streamChat: mockStreamChat }),
        prisma: { mcpServer: { findFirst: vi.fn().mockResolvedValue(prismaServer) } },
      },
      emit: vi.fn(),
    });
  }

  it('passes tools and maxSteps:10 to streamChat when mcpServerIds is set', async () => {
    const ctx = makeLlmCtx(['srv-1']);

    await executor.execute(ctx);

    expect(mockDiscoverTools).toHaveBeenCalledOnce();
    expect(mockStreamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          'test-server__tool_a': expect.objectContaining({ description: '[test-server] Tool A' }),
          'test-server__tool_b': expect.objectContaining({ description: '[test-server] Tool B' }),
        }),
        maxSteps: 10,
      }),
    );
  });

  it('does not include tools or maxSteps when mcpServerIds is empty', async () => {
    const ctx = makeLlmCtx([]);

    await executor.execute(ctx);

    expect(mockDiscoverTools).not.toHaveBeenCalled();
    expect(mockStreamChat).toHaveBeenCalledWith(
      expect.not.objectContaining({ tools: expect.anything() }),
    );
    expect(mockStreamChat).toHaveBeenCalledWith(
      expect.not.objectContaining({ maxSteps: expect.anything() }),
    );
  });

  it('does not include tools or maxSteps when mcpServerIds is absent', async () => {
    const ctx = createMockContext({
      state: createMockState({ messages: [{ role: 'user', content: 'Hello' }] }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3' },
      services: {
        llmProvider: vi.fn().mockResolvedValue({ streamChat: mockStreamChat }),
        prisma: {},
      },
      emit: vi.fn(),
    });

    await executor.execute(ctx);

    expect(mockStreamChat).toHaveBeenCalledWith(
      expect.not.objectContaining({ tools: expect.anything() }),
    );
  });

  it('disconnects all MCP clients in finally even when streamChat throws', async () => {
    mockStreamChat.mockImplementation(() => { throw new Error('LLM unavailable'); });
    const ctx = makeLlmCtx(['srv-1']);

    await expect(executor.execute(ctx)).rejects.toThrow('LLM unavailable');

    expect(mockDisconnect).toHaveBeenCalledOnce();
  });

  it('skips a server that is not active', async () => {
    const ctx = makeLlmCtx(['srv-1'], { ...MOCK_MCP_SERVER, status: 'inactive' });

    await executor.execute(ctx);

    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockDiscoverTools).not.toHaveBeenCalled();
    expect(mockStreamChat).toHaveBeenCalledWith(
      expect.not.objectContaining({ tools: expect.anything() }),
    );
  });

  it('skips a server that is not found in the database', async () => {
    const ctx = makeLlmCtx(['unknown-srv'], null);

    await executor.execute(ctx);

    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockStreamChat).toHaveBeenCalledWith(
      expect.not.objectContaining({ tools: expect.anything() }),
    );
  });

  it('tool execute functions call mcpClient.executeTool with the original tool name', async () => {
    const ctx = makeLlmCtx(['srv-1']);
    await executor.execute(ctx);

    const callArgs = mockStreamChat.mock.calls[0][0];
    const toolFn = callArgs.tools['test-server__tool_a'].execute;
    await toolFn({ key: 'val' });

    expect(mockExecuteTool).toHaveBeenCalledWith('tool_a', { key: 'val' });
  });
});

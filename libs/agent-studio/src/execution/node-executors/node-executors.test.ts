import { describe, it, expect, vi } from 'vitest';
import type { NodeExecutionContext, GraphState } from '../types';
import type { GraphNode } from '../../types/agent';
import { StateSchemaNodeExecutor } from './state-schema-executor';
import { RouterNodeExecutor } from './router-executor';
import { ToolNodeExecutor } from './tool-executor';
import { LlmNodeExecutor } from './llm-executor';

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

  it('resolves the tool from the registry, executes it, and writes a named result channel', async () => {
    const execute = vi.fn().mockResolvedValue({ results: ['ok'] });
    const ctx = createMockContext({
      node: createMockNode({ id: 'tool-1', type: 'tool', label: 'Tool' }),
      config: {
        type: 'tool',
        toolName: 'web_search',
        parameters: { query: 'test' },
      },
      services: {
        llmProvider: vi.fn(),
        prisma: {},
        toolRegistry: { web_search: { description: 'd', execute } },
      },
    });

    const result = await executor.execute(ctx);

    expect(execute).toHaveBeenCalledWith({ query: 'test' }, {});
    expect(result.stateUpdates).toEqual({ web_search_result: { results: ['ok'] }, tool_result: { results: ['ok'] } });
    expect(result.next).toBeNull();
    expect(result.trace.status).toBe('completed');
    expect(result.trace.input).toEqual({ toolName: 'web_search', parameters: { query: 'test' } });
  });

  it('fails gracefully when the tool is not in the registry', async () => {
    const ctx = createMockContext({
      node: createMockNode({ id: 'tool-1', type: 'tool', label: 'Tool' }),
      config: { type: 'tool', toolName: 'missing', parameters: {} },
      services: { llmProvider: vi.fn(), prisma: {}, toolRegistry: {} },
    });

    const result = await executor.execute(ctx);

    expect(result.stateUpdates).toEqual({ missing_result: null, tool_result: null });
    expect(result.trace.status).toBe('failed');
    expect(result.trace.error).toMatch(/not available/);
  });

  it('surfaces a thrown tool error as a failed trace', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('tool boom'));
    const ctx = createMockContext({
      node: createMockNode({ id: 'tool-1', type: 'tool', label: 'Tool' }),
      config: { type: 'tool', toolName: 'web_fetch', parameters: { url: 'https://x' } },
      services: { llmProvider: vi.fn(), prisma: {}, toolRegistry: { web_fetch: { execute } } },
    });

    const result = await executor.execute(ctx);

    expect(result.trace.status).toBe('failed');
    expect(result.trace.error).toBe('tool boom');
    expect(result.stateUpdates).toEqual({ web_fetch_result: null, tool_result: null });
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
    expect(result.trace.input).toEqual({ messageCount: 1, model: 'claude-3', toolCount: 0 });
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

  it('resolves configured tool names from the registry and passes them to the provider', async () => {
    const mockProvider = {
      streamChat: vi.fn().mockReturnValue({
        textStream: (async function* () { yield 'ok'; })(),
      }),
    };
    const webSearchTool = { description: 'search', execute: vi.fn() };
    const ctx = createMockContext({
      state: createMockState({ messages: [{ role: 'user', content: 'Hi' }] }),
      node: createMockNode({ id: 'llm-1', type: 'llm', label: 'LLM' }),
      config: { type: 'llm', model: 'claude-3', tools: ['web_search', 'not_registered'] },
      services: {
        llmProvider: vi.fn().mockResolvedValue(mockProvider),
        prisma: {},
        toolRegistry: { web_search: webSearchTool },
      },
      emit: vi.fn(),
    });

    const result = await executor.execute(ctx);

    expect(result.trace.input).toEqual({ messageCount: 1, model: 'claude-3', toolCount: 1 });
    const call = mockProvider.streamChat.mock.calls[0][0];
    expect(call.tools).toEqual({ web_search: webSearchTool });
    expect(call.maxSteps).toBe(5);
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
});

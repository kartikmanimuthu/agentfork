import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphExecutor } from './graph-executor';
import type { GraphDefinition } from '../types/agent';
import type { ExecutionServices, NodeExecutor, NodeExecutionContext, ExecutionEvent } from './types';

function createMockServices(): ExecutionServices {
  return {
    llmProvider: vi.fn().mockResolvedValue({}),
    prisma: {},
  };
}

function createMockExecutor(type: string, handler?: (ctx: NodeExecutionContext) => Promise<any>): NodeExecutor {
  return {
    type,
    execute: handler ?? (async (ctx) => ({
      stateUpdates: {},
      next: null,
      output: `executed ${ctx.node.id}`,
      trace: {
        nodeId: ctx.node.id,
        nodeType: ctx.node.type,
        nodeLabel: ctx.node.label,
        status: 'completed' as const,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    })),
  };
}

const metadata = {
  executionId: 'exec-1',
  agentId: 'agent-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
};

const input = { messages: [{ role: 'user' as const, content: 'hello' }] };

describe('GraphExecutor', () => {
  let executor: GraphExecutor;
  let services: ExecutionServices;

  beforeEach(() => {
    services = createMockServices();
    executor = new GraphExecutor(services);
  });

  describe('findEntryNode', () => {
    it('identifies the node with no incoming edges as entry', async () => {
      const graph: GraphDefinition = {
        nodes: [
          { id: 'a', type: 'llm', label: 'A', config: { type: 'llm' } as any, position: { x: 0, y: 0 } },
          { id: 'b', type: 'llm', label: 'B', config: { type: 'llm' } as any, position: { x: 100, y: 0 } },
        ],
        edges: [{ id: 'e1', source: 'a', target: 'b' }],
      };

      executor.register(createMockExecutor('llm'));
      const events: ExecutionEvent[] = [];
      await executor.execute(graph, input, metadata, {
        onEvent: (e) => events.push(e),
      });

      const nodeStarts = events.filter((e) => e.type === 'node_start');
      expect(nodeStarts[0]).toEqual({ type: 'node_start', nodeId: 'a', nodeType: 'llm' });
    });

    it('throws when all nodes have incoming edges', async () => {
      const graph: GraphDefinition = {
        nodes: [
          { id: 'a', type: 'llm', label: 'A', config: { type: 'llm' } as any, position: { x: 0, y: 0 } },
          { id: 'b', type: 'llm', label: 'B', config: { type: 'llm' } as any, position: { x: 100, y: 0 } },
        ],
        edges: [
          { id: 'e1', source: 'a', target: 'b' },
          { id: 'e2', source: 'b', target: 'a' },
        ],
      };

      executor.register(createMockExecutor('llm'));
      await expect(executor.execute(graph, input, metadata)).rejects.toThrow('no entry node found');
    });
  });

  describe('simple graph execution', () => {
    it('executes a 2-node graph in order', async () => {
      const graph: GraphDefinition = {
        nodes: [
          { id: 'start', type: 'input', label: 'Start', config: { type: 'input' } as any, position: { x: 0, y: 0 } },
          { id: 'end', type: 'output', label: 'End', config: { type: 'output' } as any, position: { x: 100, y: 0 } },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      };

      const executionOrder: string[] = [];

      executor.register(createMockExecutor('input', async (ctx) => {
        executionOrder.push(ctx.node.id);
        return {
          stateUpdates: { inputProcessed: true },
          next: null,
          trace: {
            nodeId: ctx.node.id,
            nodeType: ctx.node.type,
            status: 'completed' as const,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        };
      }));

      executor.register(createMockExecutor('output', async (ctx) => {
        executionOrder.push(ctx.node.id);
        return {
          stateUpdates: { outputProcessed: true },
          next: null,
          trace: {
            nodeId: ctx.node.id,
            nodeType: ctx.node.type,
            status: 'completed' as const,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        };
      }));

      const state = await executor.execute(graph, input, metadata);

      expect(executionOrder).toEqual(['start', 'end']);
      expect(state.channels).toMatchObject({ inputProcessed: true, outputProcessed: true });
    });

    it('follows result.next when provided', async () => {
      const graph: GraphDefinition = {
        nodes: [
          { id: 'a', type: 'router', label: 'Router', config: { type: 'router' } as any, position: { x: 0, y: 0 } },
          { id: 'b', type: 'llm', label: 'B', config: { type: 'llm' } as any, position: { x: 100, y: 0 } },
          { id: 'c', type: 'llm', label: 'C', config: { type: 'llm' } as any, position: { x: 100, y: 100 } },
        ],
        edges: [
          { id: 'e1', source: 'a', target: 'b' },
          { id: 'e2', source: 'a', target: 'c' },
        ],
      };

      executor.register(createMockExecutor('router', async (ctx) => ({
        stateUpdates: {},
        next: ['c'],
        trace: {
          nodeId: ctx.node.id,
          nodeType: ctx.node.type,
          status: 'completed' as const,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      })));

      executor.register(createMockExecutor('llm'));

      const events: ExecutionEvent[] = [];
      await executor.execute(graph, input, metadata, { onEvent: (e) => events.push(e) });

      const nodeStarts = events.filter((e) => e.type === 'node_start');
      expect(nodeStarts.map((e) => (e as any).nodeId)).toEqual(['a', 'c']);
    });
  });

  describe('maxSteps', () => {
    it('stops execution when maxSteps is reached', async () => {
      const graph: GraphDefinition = {
        nodes: [
          { id: 'entry', type: 'llm', label: 'Entry', config: { type: 'llm' } as any, position: { x: 0, y: 0 } },
          { id: 'loop', type: 'llm', label: 'Loop', config: { type: 'llm' } as any, position: { x: 100, y: 0 } },
        ],
        edges: [
          { id: 'e1', source: 'entry', target: 'loop' },
          { id: 'e2', source: 'loop', target: 'loop' },
        ],
      };

      executor.register(createMockExecutor('llm'));

      const events: ExecutionEvent[] = [];
      await executor.execute(graph, input, metadata, {
        maxSteps: 3,
        onEvent: (e) => events.push(e),
      });

      const nodeStarts = events.filter((e) => e.type === 'node_start');
      expect(nodeStarts.length).toBe(3);
    });
  });

  describe('abort signal', () => {
    it('stops execution when signal is aborted', async () => {
      const graph: GraphDefinition = {
        nodes: [
          { id: 'entry', type: 'llm', label: 'Entry', config: { type: 'llm' } as any, position: { x: 0, y: 0 } },
          { id: 'next', type: 'llm', label: 'Next', config: { type: 'llm' } as any, position: { x: 100, y: 0 } },
        ],
        edges: [{ id: 'e1', source: 'entry', target: 'next' }],
      };

      const controller = new AbortController();

      executor.register(createMockExecutor('llm', async (ctx) => {
        if (ctx.node.id === 'entry') {
          controller.abort();
        }
        return {
          stateUpdates: {},
          next: null,
          trace: {
            nodeId: ctx.node.id,
            nodeType: ctx.node.type,
            status: 'completed' as const,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        };
      }));

      const events: ExecutionEvent[] = [];
      await executor.execute(graph, input, metadata, {
        signal: controller.signal,
        onEvent: (e) => events.push(e),
      });

      const nodeStarts = events.filter((e) => e.type === 'node_start');
      expect(nodeStarts.length).toBe(1);
    });
  });

  describe('error handling', () => {
    it('emits node_error and throws when executor fails', async () => {
      const graph: GraphDefinition = {
        nodes: [
          { id: 'fail', type: 'broken', label: 'Broken', config: { type: 'broken' } as any, position: { x: 0, y: 0 } },
        ],
        edges: [],
      };

      executor.register({
        type: 'broken',
        execute: async () => { throw new Error('node exploded'); },
      });

      const events: ExecutionEvent[] = [];
      await expect(
        executor.execute(graph, input, metadata, { onEvent: (e) => events.push(e) })
      ).rejects.toThrow('node exploded');

      const errorEvents = events.filter((e) => e.type === 'node_error');
      expect(errorEvents.length).toBe(1);
      expect((errorEvents[0] as any).error).toBe('node exploded');
    });

    it('throws when no executor is registered for a node type', async () => {
      const graph: GraphDefinition = {
        nodes: [
          { id: 'unknown', type: 'mystery', label: 'Mystery', config: { type: 'mystery' } as any, position: { x: 0, y: 0 } },
        ],
        edges: [],
      };

      await expect(executor.execute(graph, input, metadata)).rejects.toThrow(
        'no executor registered for node type: mystery'
      );
    });
  });
});

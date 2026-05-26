import { createLogger } from '@chatbot/shared';
import type {
  GraphState,
  ExecutionServices,
  NodeExecutor,
  ExecutionEvent,
  ExecutionOptions,
  NodeTraceEntry,
  NodeExecutionContext,
  PauseInfo,
} from './types';
import type { GraphDefinition, GraphNode } from '../types/agent';
import { createInitialState, applyStateUpdates } from './state';

const logger = createLogger('agent-studio:graph-executor');

const DEFAULT_MAX_STEPS = 50;

export class GraphExecutor {
  private executors = new Map<string, NodeExecutor>();

  constructor(private services: ExecutionServices) {}

  register(executor: NodeExecutor): void {
    this.executors.set(executor.type, executor);
  }

  async execute(
    graph: GraphDefinition,
    input: { messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> },
    metadata: { executionId: string; agentId: string; tenantId: string; userId: string },
    options: ExecutionOptions = {}
  ): Promise<GraphState> {
    const initialState = createInitialState({
      executionId: metadata.executionId,
      agentId: metadata.agentId,
      tenantId: metadata.tenantId,
      userId: metadata.userId,
      messages: input.messages,
    });
    const entryNode = this.findEntryNode(graph);
    return this.runLoop({ ...initialState, currentNodeId: entryNode.id }, graph, metadata, options);
  }

  async executeFromState(
    graph: GraphDefinition,
    state: GraphState,
    metadata: { executionId: string; agentId: string; tenantId: string; userId: string },
    options: ExecutionOptions = {}
  ): Promise<GraphState> {
    return this.runLoop(state, graph, metadata, options);
  }

  private async runLoop(
    initialState: GraphState,
    graph: GraphDefinition,
    metadata: { executionId: string; agentId: string; tenantId: string; userId: string },
    options: ExecutionOptions
  ): Promise<GraphState> {
    const { onEvent, signal, maxSteps = DEFAULT_MAX_STEPS } = options;
    const traces: NodeTraceEntry[] = [];
    const emit = (event: ExecutionEvent): void => { onEvent?.(event); };

    let state = initialState;
    let steps = 0;
    let wasPaused = false;

    logger.info({ executionId: metadata.executionId, startNodeId: state.currentNodeId }, 'starting graph loop');

    try {
      while (state.currentNodeId) {
        if (signal?.aborted) {
          logger.warn({ executionId: metadata.executionId, step: steps }, 'execution aborted');
          break;
        }

        if (steps >= maxSteps) {
          logger.warn({ executionId: metadata.executionId, maxSteps }, 'max steps reached');
          break;
        }

        const node = graph.nodes.find((n) => n.id === state.currentNodeId);
        if (!node) {
          const error = `node not found: ${state.currentNodeId}`;
          logger.error({ executionId: metadata.executionId, nodeId: state.currentNodeId }, error);
          throw new Error(error);
        }

        const executor = this.executors.get(node.type);
        if (!executor) {
          const error = `no executor registered for node type: ${node.type}`;
          emit({ type: 'node_error', nodeId: node.id, error });
          logger.error({ executionId: metadata.executionId, nodeId: node.id, nodeType: node.type }, error);
          throw new Error(error);
        }

        emit({ type: 'node_start', nodeId: node.id, nodeType: node.type });
        const startedAt = Date.now();

        try {
          const ctx: NodeExecutionContext = { state, node, config: node.config, services: this.services, emit };
          const result = await executor.execute(ctx);

          state = applyStateUpdates(state, result.stateUpdates);
          emit({ type: 'state_update', channels: state.channels });

          // ── Pause detection ──────────────────────────────────────────────
          if (state.channels.__paused === true) {
            const resumeToken = state.channels.__resumeToken as string;
            const humanConfig = node.config as { prompt?: string; outputChannel?: string };
            const nextEdge = graph.edges.find((e) => e.source === node.id);
            const nextNodeId = nextEdge?.target ?? null;

            const pauseInfo: PauseInfo = {
              resumeToken,
              nextNodeId,
              prompt: humanConfig.prompt ?? '',
              outputChannel: humanConfig.outputChannel ?? '',
              state,
            };

            if (options.onPause) {
              await options.onPause(pauseInfo);
            }

            const trace: NodeTraceEntry = { ...result.trace, durationMs: Date.now() - startedAt };
            traces.push(trace);
            wasPaused = true;
            state = { ...state, currentNodeId: null };
            steps++;
            continue;
          }
          // ── Normal completion ────────────────────────────────────────────

          const trace: NodeTraceEntry = { ...result.trace, durationMs: Date.now() - startedAt };
          traces.push(trace);
          emit({ type: 'node_complete', nodeId: node.id, trace });

          const nextNodeId = this.resolveNextNode(node, result.next, graph);
          state = { ...state, currentNodeId: nextNodeId };
        } catch (nodeError) {
          const errorMessage = nodeError instanceof Error ? nodeError.message : String(nodeError);
          const failedTrace: NodeTraceEntry = {
            nodeId: node.id, nodeType: node.type, nodeLabel: node.label,
            status: 'failed', startedAt: new Date(startedAt).toISOString(),
            completedAt: new Date().toISOString(), error: errorMessage,
            durationMs: Date.now() - startedAt,
          };
          traces.push(failedTrace);
          emit({ type: 'node_error', nodeId: node.id, error: errorMessage });
          logger.error({ executionId: metadata.executionId, nodeId: node.id, error: errorMessage }, 'node execution failed');
          throw nodeError;
        }

        steps++;
      }
    } catch (error) {
      logger.error({ executionId: metadata.executionId, error }, 'graph execution failed');
      throw error;
    }

    if (!wasPaused) {
      emit({ type: 'execution_complete', finalState: state, trace: traces });
    }
    logger.info({ executionId: metadata.executionId, steps, traceCount: traces.length }, 'graph execution complete');

    return state;
  }

  private findEntryNode(graph: GraphDefinition): GraphNode {
    const targetIds = new Set(graph.edges.map((e) => e.target));
    const entryNodes = graph.nodes.filter((n) => !targetIds.has(n.id));
    if (entryNodes.length === 0) throw new Error('no entry node found: all nodes have incoming edges');
    return entryNodes[0];
  }

  private resolveNextNode(currentNode: GraphNode, resultNext: string[] | null, graph: GraphDefinition): string | null {
    if (resultNext && resultNext.length > 0) return resultNext[0];
    const outgoingEdges = graph.edges.filter((e) => e.source === currentNode.id);
    if (outgoingEdges.length === 0) return null;
    return outgoingEdges[0].target;
  }
}

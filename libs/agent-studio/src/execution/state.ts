import type { GraphState } from './types';

export function createInitialState(params: {
  executionId: string;
  agentId: string;
  tenantId: string;
  userId: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  initialChannels?: Record<string, unknown>;
}): GraphState {
  return {
    channels: params.initialChannels ?? {},
    messages: params.messages,
    currentNodeId: null,
    metadata: {
      executionId: params.executionId,
      agentId: params.agentId,
      tenantId: params.tenantId,
      userId: params.userId,
      startedAt: new Date(),
    },
  };
}

export function readChannel<T = unknown>(state: GraphState, channel: string): T | undefined {
  return state.channels[channel] as T | undefined;
}

export function writeChannel(state: GraphState, channel: string, value: unknown): GraphState {
  return {
    ...state,
    channels: { ...state.channels, [channel]: value },
  };
}

export function applyStateUpdates(state: GraphState, updates: Record<string, unknown>): GraphState {
  return {
    ...state,
    channels: { ...state.channels, ...updates },
  };
}

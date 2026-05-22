export type EventSeverity = 'info' | 'warn' | 'error';

export interface ConsoleEvent {
  id: string;
  messageId: string;
  timestamp: number;
  relativeMs: number;
  severity: EventSeverity;
  type: string;
  data: Record<string, unknown>;
}

export interface MessageMetrics {
  messageId: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  ttftMs: number;
  durationMs: number;
  model: string;
  costEstimate: CostEstimate;
}

export interface CostEstimate {
  input: number;
  output: number;
  thinking: number;
  total: number;
}

export interface SessionMetrics {
  totalTokens: number;
  totalCost: number;
  messageCount: number;
  avgTokensPerMessage: number;
  avgLatencyMs: number;
  tokensByMessage: Array<{ messageId: string; input: number; output: number; thinking: number }>;
  latencyByMessage: Array<{ messageId: string; durationMs: number }>;
}

export interface RawData {
  request: { method: string; url: string; headers: Record<string, string>; body: unknown };
  response: { status: number; headers: Record<string, string>; ttfbMs?: number };
  sseStream: string[];
}

export interface ThinkingContent {
  text: string;
  tokens: number;
  durationMs: number;
}

export type ConsoleTab = 'events' | 'raw' | 'trace' | 'metrics' | 'config';

export interface TraceNode {
  id: string;
  name: string;
  type: string;
  status: 'running' | 'completed' | 'failed';
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  children?: TraceNode[];
}

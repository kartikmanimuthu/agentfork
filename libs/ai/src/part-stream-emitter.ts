import type { StreamEvent, MessagePart, ThinkingStep } from './stream-events';
import { toolLabel } from './tool-label';

interface FinishUsage { inputTokens?: number; outputTokens?: number }

export function isFileGenTool(toolName: string): boolean {
  return toolName === 'generate_spreadsheet' || toolName === 'generate_pdf';
}

/** Turn a tool-result object into ≤4 short string key/values for a thinking-step data card. */
function compactData(output: unknown): Record<string, string> | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const entries = Object.entries(output as Record<string, unknown>)
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
    .slice(0, 4)
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export class PartStreamEmitter {
  /** Accumulated parts for persistence (populated as the stream is consumed). */
  readonly parts: MessagePart[] = [];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;

  private thinkingIndex: number | null = null;
  private textIndex: number | null = null;
  private stepByToolCallId = new Map<string, string>();

  constructor(private readonly messageId: string, private readonly opts: { showThinking?: boolean } = {}) {}

  private seed(t: MessagePart['type']): MessagePart {
    if (t === 'thinking') return { type: 'thinking', status: 'active', steps: [] };
    return { type: 'text', text: '' };
  }

  private startEvent(partType: MessagePart['type'], part?: MessagePart): StreamEvent {
    const partIndex = this.parts.length;
    this.parts.push(part ?? this.seed(partType));
    return { type: 'part_start', messageId: this.messageId, partIndex, partType, ...(part ? { part } : {}) };
  }

  async *run(fullStream: AsyncIterable<any>): AsyncGenerator<StreamEvent> {
    try {
      for await (const chunk of fullStream) {
        switch (chunk.type) {
          case 'tool-call':   for (const e of this.onToolCall(chunk)) yield e; break;
          case 'tool-result': for (const e of this.onToolResult(chunk)) yield e; break;
          case 'text-delta':  for (const e of this.onTextDelta(chunk.text ?? chunk.textDelta ?? '')) yield e; break;
          case 'finish':      for (const e of this.onFinish(chunk.usage)) yield e; break;
          case 'error':       yield this.errorEvent(String(chunk.error ?? 'stream error')); return;
          default:            break;
        }
      }
    } catch (err) {
      yield this.errorEvent(err instanceof Error ? err.message : String(err));
      return;
    }
  }

  private onToolCall(chunk: { toolCallId: string; toolName: string }): StreamEvent[] {
    if (isFileGenTool(chunk.toolName)) return [];
    if (this.opts.showThinking === false) return [];
    const events: StreamEvent[] = [];
    if (this.thinkingIndex === null) {
      events.push(this.startEvent('thinking'));
      this.thinkingIndex = this.parts.length - 1;
    }
    const step: ThinkingStep = { id: chunk.toolCallId, label: toolLabel(chunk.toolName), status: 'active' };
    (this.parts[this.thinkingIndex] as Extract<MessagePart, { type: 'thinking' }>).steps.push(step);
    this.stepByToolCallId.set(chunk.toolCallId, chunk.toolCallId);
    events.push({ type: 'thinking_step', messageId: this.messageId, partIndex: this.thinkingIndex, step: { ...step } });
    return events;
  }

  private onToolResult(chunk: { toolCallId: string; toolName: string; output?: any }): StreamEvent[] {
    const events: StreamEvent[] = [];
    const filePart = chunk.output?.__filePart as MessagePart | undefined;
    if (filePart && filePart.type === 'file') {
      if (this.thinkingIndex !== null) {
        events.push({ type: 'part_complete', messageId: this.messageId, partIndex: this.thinkingIndex });
        (this.parts[this.thinkingIndex] as Extract<MessagePart, { type: 'thinking' }>).status = 'done';
        this.thinkingIndex = null;
      }
      events.push(this.startEvent('file', filePart));
      const idx = this.parts.length - 1;
      events.push({ type: 'part_complete', messageId: this.messageId, partIndex: idx });
      return events;
    }
    const stepId = this.stepByToolCallId.get(chunk.toolCallId);
    if (stepId !== undefined && this.thinkingIndex !== null) {
      const thinking = this.parts[this.thinkingIndex] as Extract<MessagePart, { type: 'thinking' }>;
      const step = thinking.steps.find((s) => s.id === stepId);
      if (step) {
        step.status = 'done';
        const data = compactData(chunk.output);
        if (data) step.data = data;
        events.push({ type: 'thinking_step', messageId: this.messageId, partIndex: this.thinkingIndex, step: { ...step } });
      }
    }
    return events;
  }

  private onTextDelta(text: string): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this.thinkingIndex !== null) {
      events.push({ type: 'part_complete', messageId: this.messageId, partIndex: this.thinkingIndex });
      (this.parts[this.thinkingIndex] as Extract<MessagePart, { type: 'thinking' }>).status = 'done';
      this.thinkingIndex = null;
    }
    if (this.textIndex === null) {
      events.push(this.startEvent('text'));
      this.textIndex = this.parts.length - 1;
    }
    (this.parts[this.textIndex] as Extract<MessagePart, { type: 'text' }>).text += text;
    events.push({ type: 'token', messageId: this.messageId, partIndex: this.textIndex, content: text });
    return events;
  }

  private onFinish(usage?: FinishUsage): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this.textIndex !== null) {
      events.push({ type: 'part_complete', messageId: this.messageId, partIndex: this.textIndex });
      this.textIndex = null;
    } else if (this.thinkingIndex !== null) {
      events.push({ type: 'part_complete', messageId: this.messageId, partIndex: this.thinkingIndex });
      (this.parts[this.thinkingIndex] as Extract<MessagePart, { type: 'thinking' }>).status = 'done';
      this.thinkingIndex = null;
    }
    const i = usage?.inputTokens ?? 0;
    const o = usage?.outputTokens ?? 0;
    this.usage = { inputTokens: i, outputTokens: o, totalTokens: i + o };
    events.push({ type: 'done', messageId: this.messageId, usage: this.usage });
    return events;
  }

  private errorEvent(message: string): StreamEvent {
    return { type: 'error', messageId: this.messageId, message };
  }
}

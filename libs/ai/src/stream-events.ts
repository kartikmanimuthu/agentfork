export interface ThinkingStep {
  id: string;
  label: string;
  detail?: string;
  status: 'active' | 'done';
  data?: Record<string, string>;
}
export interface MenuOption { label: string; value: string; icon?: string }
export interface CardButton { label: string; url?: string; value?: string }

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; status: 'active' | 'done'; steps: ThinkingStep[] }
  | { type: 'menu'; title?: string; options: MenuOption[] }
  | { type: 'file'; name: string; mimeType: string; url: string; sizeBytes?: number }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'card'; title: string; description?: string; buttons?: CardButton[] };

export type MessagePartType = MessagePart['type'];

export interface StreamEvent {
  type: 'part_start' | 'token' | 'thinking_step' | 'part_complete' | 'done' | 'error';
  messageId?: string;
  partIndex?: number;
  partType?: MessagePartType;
  content?: string;
  step?: ThinkingStep;
  message?: string;
  part?: MessagePart;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

/** Serialize one event to an SSE `data:` frame (newline-terminated). */
export function toSseFrame(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

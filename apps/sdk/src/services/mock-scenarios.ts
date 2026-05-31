import type { StreamEvent } from '../types';

export interface ScriptedEvent {
  event: StreamEvent;
  delayMs: number;
}
export type ScenarioKey = 'thinking' | 'menu' | 'files' | 'image' | 'error';

const M = 'mock-msg';

export const SCENARIOS: Record<ScenarioKey, ScriptedEvent[]> = {
  // 1. Thinking timeline, then a text answer
  thinking: [
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 0, partType: 'thinking' } },
    { delayMs: 400, event: { type: 'thinking_step', messageId: M, partIndex: 0, step: { id: 's1', label: 'Understanding the question', status: 'active' } } },
    { delayMs: 500, event: { type: 'thinking_step', messageId: M, partIndex: 0, step: { id: 's1', label: 'Understanding the question', status: 'done' } } },
    { delayMs: 200, event: { type: 'thinking_step', messageId: M, partIndex: 0, step: { id: 's2', label: 'Searching knowledge base', status: 'active', data: { hits: '4', source: 'docs' } } } },
    { delayMs: 600, event: { type: 'thinking_step', messageId: M, partIndex: 0, step: { id: 's2', label: 'Searching knowledge base', status: 'done', data: { hits: '4', source: 'docs' } } } },
    { delayMs: 200, event: { type: 'part_complete', messageId: M, partIndex: 0 } },
    { delayMs: 100, event: { type: 'part_start', messageId: M, partIndex: 1, partType: 'text' } },
    { delayMs: 120, event: { type: 'token', messageId: M, partIndex: 1, content: 'Based on your plan, ' } },
    { delayMs: 120, event: { type: 'token', messageId: M, partIndex: 1, content: 'refunds are processed within 5 business days.' } },
    { delayMs: 100, event: { type: 'part_complete', messageId: M, partIndex: 1 } },
    { delayMs: 60, event: { type: 'done', messageId: M } },
  ],
  // 2. Server-driven menu
  menu: [
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 0, partType: 'text' } },
    { delayMs: 120, event: { type: 'token', messageId: M, partIndex: 0, content: 'What can I help you with today?' } },
    { delayMs: 80, event: { type: 'part_complete', messageId: M, partIndex: 0 } },
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 1, partType: 'menu', part: { type: 'menu', title: 'Choose a topic', options: [
      { label: 'Billing & refunds', value: 'topic:billing', icon: '💳' },
      { label: 'Technical support', value: 'topic:support', icon: '🛠️' },
      { label: 'Account settings', value: 'topic:account', icon: '⚙️' },
    ] } } },
    { delayMs: 80, event: { type: 'part_complete', messageId: M, partIndex: 1 } },
    { delayMs: 60, event: { type: 'done', messageId: M } },
  ],
  // 3. Text + PDF + spreadsheet artifacts
  files: [
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 0, partType: 'text' } },
    { delayMs: 120, event: { type: 'token', messageId: M, partIndex: 0, content: 'Here is your report and the raw data:' } },
    { delayMs: 80, event: { type: 'part_complete', messageId: M, partIndex: 0 } },
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 1, partType: 'file', part: { type: 'file', name: 'Q2-summary.pdf', mimeType: 'application/pdf', url: 'data:application/pdf;base64,JVBERi0xLjQK', sizeBytes: 248000 } } },
    { delayMs: 80, event: { type: 'part_complete', messageId: M, partIndex: 1 } },
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 2, partType: 'file', part: { type: 'file', name: 'metrics.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', url: 'data:text/plain;base64,bW9jaw==', sizeBytes: 51200 } } },
    { delayMs: 80, event: { type: 'part_complete', messageId: M, partIndex: 2 } },
    { delayMs: 60, event: { type: 'done', messageId: M } },
  ],
  // 4. Image output
  image: [
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 0, partType: 'text' } },
    { delayMs: 120, event: { type: 'token', messageId: M, partIndex: 0, content: 'Here is the chart you asked for:' } },
    { delayMs: 80, event: { type: 'part_complete', messageId: M, partIndex: 0 } },
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 1, partType: 'image', part: { type: 'image', url: 'https://placehold.co/480x280/png', alt: 'Revenue chart' } } },
    { delayMs: 80, event: { type: 'part_complete', messageId: M, partIndex: 1 } },
    { delayMs: 60, event: { type: 'done', messageId: M } },
  ],
  // 5. Mid-stream error + retry
  error: [
    { delayMs: 120, event: { type: 'part_start', messageId: M, partIndex: 0, partType: 'text' } },
    { delayMs: 120, event: { type: 'token', messageId: M, partIndex: 0, content: 'Let me look that up' } },
    { delayMs: 300, event: { type: 'error', messageId: M, message: 'Upstream timeout' } },
  ],
};

import { createStore } from '@stencil/store';
import type { WidgetState, Message, MessagePart, ThinkingStep, KbArticle, SdkWidgetConfig, SessionInfo } from '../types';

const { state, onChange, reset } = createStore<WidgetState>({
  config: null,
  apiKey: null,
  baseUrl: window.location.origin,
  session: null,
  messages: [],
  uiState: { open: false, minimized: false, hidden: false },
  streaming: { active: false, currentTokens: '' },
  preChatDone: false,
  unreadCount: 0,
  kbSuggestions: [],
  error: null,
  csatPending: false,
  csatSubmitted: false,
});

export { state, onChange, reset };

export function setConfig(config: SdkWidgetConfig) {
  state.config = config;
}

export function setApiKey(key: string) {
  state.apiKey = key;
}

export function setBaseUrl(url: string) {
  state.baseUrl = url;
}

export function setSession(session: SessionInfo) {
  state.session = session;
}

export function addMessage(message: Message) {
  state.messages = [...state.messages, message];
}

function patchMessage(messageId: string, fn: (m: Message) => Message) {
  const idx = state.messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return;
  const msgs = [...state.messages];
  msgs[idx] = fn(msgs[idx]);
  state.messages = msgs;
}

export function appendPart(messageId: string, part: MessagePart) {
  patchMessage(messageId, (m) => ({ ...m, status: 'streaming', parts: [...m.parts, part] }));
}

export function appendTokenToPart(messageId: string, partIndex: number, content: string) {
  patchMessage(messageId, (m) => {
    const parts = [...m.parts];
    const p = parts[partIndex];
    if (p && p.type === 'text') parts[partIndex] = { ...p, text: p.text + content };
    return { ...m, parts };
  });
}

export function upsertThinkingStep(messageId: string, partIndex: number, step: ThinkingStep) {
  patchMessage(messageId, (m) => {
    const parts = [...m.parts];
    const p = parts[partIndex];
    if (p && p.type === 'thinking') {
      const steps = [...p.steps];
      const i = steps.findIndex((s) => s.id === step.id);
      if (i === -1) steps.push(step);
      else steps[i] = { ...steps[i], ...step };
      parts[partIndex] = { ...p, steps };
    }
    return { ...m, parts };
  });
}

export function completePart(messageId: string, partIndex: number) {
  patchMessage(messageId, (m) => {
    const parts = [...m.parts];
    const p = parts[partIndex];
    if (p && p.type === 'thinking') parts[partIndex] = { ...p, status: 'done' };
    return { ...m, parts };
  });
}

export function finalizeLastMessage(messageId: string) {
  const last = state.messages[state.messages.length - 1];
  if (last && last.role === 'assistant') {
    patchMessage(last.id, (m) => ({ ...m, id: messageId, status: 'complete' }));
  }
}

export function markLastMessageError(text = 'Sorry, something went wrong. Please try again.') {
  const last = state.messages[state.messages.length - 1];
  if (last && last.role === 'assistant') {
    patchMessage(last.id, (m) => ({
      ...m,
      status: 'error',
      parts: m.parts.length ? m.parts : [{ type: 'text', text }],
    }));
  }
}

export function setMessages(messages: Message[]) {
  state.messages = messages;
}

export function setStreaming(active: boolean, currentTokens = '') {
  state.streaming = { active, currentTokens };
}

export function setUiState(partial: Partial<WidgetState['uiState']>) {
  state.uiState = { ...state.uiState, ...partial };
}

export function setPreChatDone(done: boolean) {
  state.preChatDone = done;
}

export function incrementUnread() {
  state.unreadCount = state.unreadCount + 1;
}

export function clearUnread() {
  state.unreadCount = 0;
}

export function setKbSuggestions(articles: KbArticle[]) {
  state.kbSuggestions = articles;
}

export function setError(error: string | null) {
  state.error = error;
}

export function setCsatPending(pending: boolean) {
  state.csatPending = pending;
}

export function setCsatSubmitted(submitted: boolean) {
  state.csatSubmitted = submitted;
}

export function resetCsat() {
  state.csatPending = false;
  state.csatSubmitted = false;
}

export function resetWidget() {
  state.session = null;
  state.messages = [];
  state.preChatDone = false;
  state.csatPending = false;
  state.csatSubmitted = false;
  state.streaming = { active: false, currentTokens: '' };
  state.kbSuggestions = [];
  state.error = null;
}

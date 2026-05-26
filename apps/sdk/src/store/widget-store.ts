import { createStore } from '@stencil/store';
import type { WidgetState, Message, KbArticle, SdkWidgetConfig, SessionInfo } from '../types';

const { state, onChange, reset } = createStore<WidgetState>({
  config: null,
  apiKey: null,
  session: null,
  messages: [],
  uiState: { open: false, minimized: false, hidden: false },
  streaming: { active: false, currentTokens: '' },
  preChatDone: false,
  unreadCount: 0,
  kbSuggestions: [],
  error: null,
});

export { state, onChange, reset };

export function setConfig(config: SdkWidgetConfig) {
  state.config = config;
}

export function setApiKey(key: string) {
  state.apiKey = key;
}

export function setSession(session: SessionInfo) {
  state.session = session;
}

export function addMessage(message: Message) {
  state.messages = [...state.messages, message];
}

export function updateLastMessage(content: string) {
  const msgs = [...state.messages];
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'assistant') {
    msgs[msgs.length - 1] = { ...last, content, status: 'streaming' };
    state.messages = msgs;
  }
}

export function finalizeLastMessage(messageId: string) {
  const msgs = [...state.messages];
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'assistant') {
    msgs[msgs.length - 1] = { ...last, id: messageId, status: 'sent' };
    state.messages = msgs;
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

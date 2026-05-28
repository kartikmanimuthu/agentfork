import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  state,
  reset,
  onChange,
  setConfig,
  setApiKey,
  setBaseUrl,
  setSession,
  addMessage,
  updateLastMessage,
  finalizeLastMessage,
  setMessages,
  setStreaming,
  setUiState,
  setPreChatDone,
  incrementUnread,
  clearUnread,
  setKbSuggestions,
  setError,
  setCsatPending,
  setCsatSubmitted,
  resetCsat,
  resetWidget,
} from '../widget-store';
import type { SdkWidgetConfig, Message, SessionInfo, KbArticle } from '../../types';

const mockConfig: SdkWidgetConfig = {
  agentId: 'agent_1',
  apiKeyPrefix: 'smc_abc',
  theme: 'light',
  primaryColor: '#ff0000',
  secondaryColor: '#00ff00',
  position: 'right',
  headerText: 'Chat',
  headerIcon: null,
  botName: 'Bot',
  botAvatar: null,
  welcomeMessage: 'Hello!',
  inputPlaceholder: 'Ask me...',
  preChatForm: null,
  quickReplies: null,
  proactiveRules: null,
  kbEnabled: false,
  fileUpload: false,
  csatEnabled: false,
  csatType: 'thumbs',
};

const mockSession: SessionInfo = {
  id: 'sess_1',
  status: 'active',
  visitorId: 'v_abc',
};

const mockMessage: Message = {
  id: 'msg_1',
  content: 'Hello',
  role: 'user',
  timestamp: '2024-01-01T00:00:00.000Z',
  status: 'sent',
};

const mockAssistantMessage: Message = {
  id: 'stream_1',
  content: '',
  role: 'assistant',
  timestamp: '2024-01-01T00:00:01.000Z',
  status: 'streaming',
};

const mockKbArticles: KbArticle[] = [{ id: '1', title: 'Help', snippet: 'How to...' }];

describe('Widget Store', () => {
  beforeEach(() => {
    reset();
  });

  it('has correct initial state', () => {
    expect(state.config).toBeNull();
    expect(state.apiKey).toBeNull();
    expect(state.baseUrl).toBe('http://localhost:3000');
    expect(state.session).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.uiState).toEqual({ open: false, minimized: false, hidden: false });
    expect(state.streaming).toEqual({ active: false, currentTokens: '' });
    expect(state.preChatDone).toBe(false);
    expect(state.unreadCount).toBe(0);
    expect(state.kbSuggestions).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.csatPending).toBe(false);
    expect(state.csatSubmitted).toBe(false);
  });

  describe('setConfig', () => {
    it('stores config object', () => {
      setConfig(mockConfig);
      expect(state.config).toEqual(mockConfig);
    });

    it('replaces previous config (not merge)', () => {
      setConfig(mockConfig);
      const newConfig = { ...mockConfig, theme: 'dark' as const };
      setConfig(newConfig);
      expect(state.config).toEqual(newConfig);
      expect(state.config?.theme).toBe('dark');
    });
  });

  describe('setBaseUrl', () => {
    it('stores baseUrl string', () => {
      setBaseUrl('https://custom.example.com');
      expect(state.baseUrl).toBe('https://custom.example.com');
    });

    it('overwrites previous value', () => {
      setBaseUrl('https://old.example.com');
      setBaseUrl('https://new.example.com');
      expect(state.baseUrl).toBe('https://new.example.com');
    });
  });

  describe('setApiKey', () => {
    it('stores apiKey string', () => {
      setApiKey('key123');
      expect(state.apiKey).toBe('key123');
    });

    it('overwrites previous value', () => {
      setApiKey('old_key');
      setApiKey('new_key');
      expect(state.apiKey).toBe('new_key');
    });
  });

  describe('setSession', () => {
    it('stores session object', () => {
      setSession(mockSession);
      expect(state.session).toEqual(mockSession);
    });

    it('sets session to null', () => {
      setSession(mockSession);
      setSession(null as any);
      expect(state.session).toBeNull();
    });
  });

  describe('addMessage', () => {
    it('appends message to empty array', () => {
      addMessage(mockMessage);
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toEqual(mockMessage);
    });

    it('appends multiple messages in order', () => {
      addMessage(mockMessage);
      addMessage(mockAssistantMessage);
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].role).toBe('user');
      expect(state.messages[1].role).toBe('assistant');
    });

    it('creates a new array reference (immutability)', () => {
      const before = state.messages;
      addMessage(mockMessage);
      expect(state.messages).not.toBe(before);
    });
  });

  describe('updateLastMessage', () => {
    it('updates last assistant message content and sets status to streaming', () => {
      addMessage(mockAssistantMessage);
      updateLastMessage('Hello World');
      const last = state.messages[state.messages.length - 1];
      expect(last.content).toBe('Hello World');
      expect(last.status).toBe('streaming');
      expect(last.id).toBe('stream_1'); // preserved
      expect(last.role).toBe('assistant'); // preserved
    });

    it('accumulates content on repeated calls (streaming)', () => {
      addMessage(mockAssistantMessage);
      updateLastMessage('Hello');
      updateLastMessage('Hello World');
      updateLastMessage('Hello World!');
      expect(state.messages[0].content).toBe('Hello World!');
    });

    it('does nothing when messages is empty', () => {
      updateLastMessage('content');
      expect(state.messages).toHaveLength(0);
    });

    it('does nothing when last message is user role', () => {
      addMessage(mockMessage); // user message
      updateLastMessage('new content');
      expect(state.messages[0].content).toBe('Hello'); // unchanged
      expect(state.messages[0].status).toBe('sent'); // unchanged
    });
  });

  describe('finalizeLastMessage', () => {
    it('sets id and changes status to sent on last assistant message', () => {
      addMessage(mockAssistantMessage);
      finalizeLastMessage('msg_final');
      const last = state.messages[state.messages.length - 1];
      expect(last.id).toBe('msg_final');
      expect(last.status).toBe('sent');
      expect(last.role).toBe('assistant'); // preserved
    });

    it('does nothing when messages is empty', () => {
      finalizeLastMessage('msg_1');
      expect(state.messages).toHaveLength(0);
    });

    it('does nothing when last message is user role', () => {
      addMessage(mockMessage);
      finalizeLastMessage('msg_1');
      expect(state.messages[0].id).toBe('msg_1'); // unchanged
      expect(state.messages[0].status).toBe('sent'); // unchanged
    });
  });

  describe('setMessages', () => {
    it('replaces entire messages array', () => {
      addMessage(mockMessage);
      addMessage(mockAssistantMessage);
      expect(state.messages).toHaveLength(2);

      setMessages([]);
      expect(state.messages).toHaveLength(0);
    });

    it('sets new array of messages', () => {
      const msgs = [mockMessage, mockAssistantMessage];
      setMessages(msgs);
      expect(state.messages).toHaveLength(2);
      expect(state.messages).toEqual(msgs);
    });
  });

  describe('setStreaming', () => {
    it('sets streaming active with tokens', () => {
      setStreaming(true, 'Hello');
      expect(state.streaming).toEqual({ active: true, currentTokens: 'Hello' });
    });

    it('sets streaming inactive', () => {
      setStreaming(false);
      expect(state.streaming).toEqual({ active: false, currentTokens: '' });
    });

    it('defaults currentTokens to empty string', () => {
      setStreaming(true);
      expect(state.streaming.currentTokens).toBe('');
    });
  });

  describe('setUiState', () => {
    it('merges partial UI state', () => {
      setUiState({ open: true });
      expect(state.uiState).toEqual({ open: true, minimized: false, hidden: false });
    });

    it('preserves unchanged fields', () => {
      setUiState({ open: true });
      setUiState({ minimized: true });
      expect(state.uiState).toEqual({ open: true, minimized: true, hidden: false });
    });

    it('creates new object reference', () => {
      const before = state.uiState;
      setUiState({ open: true });
      expect(state.uiState).not.toBe(before);
    });
  });

  describe('setPreChatDone', () => {
    it('sets to true', () => {
      setPreChatDone(true);
      expect(state.preChatDone).toBe(true);
    });

    it('sets to false', () => {
      setPreChatDone(true);
      setPreChatDone(false);
      expect(state.preChatDone).toBe(false);
    });
  });

  describe('incrementUnread', () => {
    it('increments by 1 each call', () => {
      expect(state.unreadCount).toBe(0);
      incrementUnread();
      expect(state.unreadCount).toBe(1);
      incrementUnread();
      expect(state.unreadCount).toBe(2);
      incrementUnread();
      expect(state.unreadCount).toBe(3);
    });
  });

  describe('clearUnread', () => {
    it('resets unread count to 0', () => {
      incrementUnread();
      incrementUnread();
      expect(state.unreadCount).toBe(2);
      clearUnread();
      expect(state.unreadCount).toBe(0);
    });
  });

  describe('setKbSuggestions', () => {
    it('stores articles array', () => {
      setKbSuggestions(mockKbArticles);
      expect(state.kbSuggestions).toEqual(mockKbArticles);
    });

    it('sets empty array', () => {
      setKbSuggestions(mockKbArticles);
      setKbSuggestions([]);
      expect(state.kbSuggestions).toEqual([]);
    });
  });

  describe('setError', () => {
    it('stores error string', () => {
      setError('Something went wrong');
      expect(state.error).toBe('Something went wrong');
    });

    it('clears error with null', () => {
      setError('Error');
      setError(null);
      expect(state.error).toBeNull();
    });
  });

  describe('setCsatPending', () => {
    it('sets to true', () => {
      setCsatPending(true);
      expect(state.csatPending).toBe(true);
    });

    it('sets to false', () => {
      setCsatPending(true);
      setCsatPending(false);
      expect(state.csatPending).toBe(false);
    });
  });

  describe('setCsatSubmitted', () => {
    it('sets to true', () => {
      setCsatSubmitted(true);
      expect(state.csatSubmitted).toBe(true);
    });

    it('sets to false', () => {
      setCsatSubmitted(true);
      setCsatSubmitted(false);
      expect(state.csatSubmitted).toBe(false);
    });
  });

  describe('resetCsat', () => {
    it('resets both csatPending and csatSubmitted to false', () => {
      setCsatPending(true);
      setCsatSubmitted(true);
      resetCsat();
      expect(state.csatPending).toBe(false);
      expect(state.csatSubmitted).toBe(false);
    });
  });

  describe('resetWidget', () => {
    it('resets session, messages, preChatDone, csat, streaming, kbSuggestions, error', () => {
      setConfig(mockConfig);
      setApiKey('key123');
      setBaseUrl('https://custom.example.com');
      setSession(mockSession);
      addMessage(mockMessage);
      setStreaming(true, 'tokens');
      setUiState({ open: true });
      setPreChatDone(true);
      incrementUnread();
      incrementUnread();
      setKbSuggestions(mockKbArticles);
      setError('error');
      setCsatPending(true);
      setCsatSubmitted(true);

      resetWidget();

      expect(state.config).not.toBeNull(); // preserved
      expect(state.apiKey).not.toBeNull(); // preserved
      expect(state.baseUrl).toBe('https://custom.example.com'); // preserved
      expect(state.uiState.open).toBe(true); // preserved
      expect(state.unreadCount).toBe(2); // preserved

      expect(state.session).toBeNull();
      expect(state.messages).toEqual([]);
      expect(state.preChatDone).toBe(false);
      expect(state.csatPending).toBe(false);
      expect(state.csatSubmitted).toBe(false);
      expect(state.streaming).toEqual({ active: false, currentTokens: '' });
      expect(state.kbSuggestions).toEqual([]);
      expect(state.error).toBeNull();
    });
  });

  describe('onChange', () => {
    it('fires when state mutates', () => {
      const listener = vi.fn();
      const unsub = onChange('config', listener);
      setConfig(mockConfig);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(mockConfig);
      unsub();
    });

    it('does not fire after unsubscribe', () => {
      const listener = vi.fn();
      const unsub = onChange('config', listener);
      unsub();
      setConfig(mockConfig);
      expect(listener).not.toHaveBeenCalled();
    });
  });
});

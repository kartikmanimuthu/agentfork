import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcMessageList } from './smc-message-list';
import { SmcMessage } from '../smc-message/smc-message';
import { SmcMarkdown } from '../smc-markdown/smc-markdown';
import { SmcTimestamp } from '../smc-timestamp/smc-timestamp';
import { SmcTypingIndicator } from '../smc-typing-indicator/smc-typing-indicator';
import { state, setConfig, setMessages, setStreaming, addMessage, reset } from '../../store/widget-store';
import type { SdkWidgetConfig } from '../../types';

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
  welcomeMessage: 'Welcome!',
  inputPlaceholder: 'Ask me...',
  preChatForm: null,
  quickReplies: null,
  proactiveRules: null,
  kbEnabled: false,
  fileUpload: false,
  csatEnabled: false,
  csatType: 'thumbs',
};

describe('SmcMessageList', () => {
  beforeEach(() => {
    reset();
  });

  it('shows welcome message when no messages and welcomeMessage set', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-message-list />);

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('smc-message')).toBeTruthy();
  });

  it('does not show welcome when messages exist', async () => {
    setConfig(mockConfig);
    addMessage({
      id: 'msg_1',
      content: 'Hi',
      role: 'user',
      timestamp: new Date().toISOString(),
      status: 'sent',
    });

    const { root } = await render(<smc-message-list />);

    // Should show the actual message, not welcome
    expect(root.shadowRoot!.querySelectorAll('smc-message')).toHaveLength(1);
  });

  it('does not show welcome when welcomeMessage is empty', async () => {
    setConfig({ ...mockConfig, welcomeMessage: '' });

    const { root } = await render(<smc-message-list />);

    expect(root.shadowRoot!.querySelector('smc-message')).toBeNull();
  });

  it('renders all messages', async () => {
    setConfig(mockConfig);
    setMessages([
      { id: 'msg_1', content: 'A', role: 'user', timestamp: '2024-01-01T00:00:00.000Z', status: 'sent' },
      { id: 'msg_2', content: 'B', role: 'assistant', timestamp: '2024-01-01T00:06:00.000Z', status: 'sent' },
      { id: 'msg_3', content: 'C', role: 'user', timestamp: '2024-01-01T00:12:00.000Z', status: 'sent' },
    ]);

    const { root } = await render(<smc-message-list />);

    const messages = root.shadowRoot!.querySelectorAll('smc-message');
    expect(messages).toHaveLength(3);
  });

  it('inserts timestamp between messages >5 min apart', async () => {
    setConfig(mockConfig);
    setMessages([
      { id: 'msg_1', content: 'First', role: 'user', timestamp: '2024-01-01T00:00:00.000Z', status: 'sent' },
      { id: 'msg_2', content: 'Second', role: 'assistant', timestamp: '2024-01-01T00:10:00.000Z', status: 'sent' },
    ]);

    const { root } = await render(<smc-message-list />);

    // First message has timestamp, plus one between them = 2
    const timestamps = root.shadowRoot!.querySelectorAll('smc-timestamp');
    expect(timestamps).toHaveLength(2);
  });

  it('does not insert timestamp when diff <= 5 min', async () => {
    setConfig(mockConfig);
    setMessages([
      { id: 'msg_1', content: 'First', role: 'user', timestamp: '2024-01-01T00:00:00.000Z', status: 'sent' },
      { id: 'msg_2', content: 'Second', role: 'assistant', timestamp: '2024-01-01T00:03:00.000Z', status: 'sent' },
    ]);

    const { root } = await render(<smc-message-list />);

    // Only first message has timestamp
    const timestamps = root.shadowRoot!.querySelectorAll('smc-timestamp');
    expect(timestamps).toHaveLength(1);
  });

  it('shows typing indicator when streaming.active is true', async () => {
    setConfig(mockConfig);
    setStreaming(true, 'Loading...');

    const { root } = await render(<smc-message-list />);

    expect(root.shadowRoot!.querySelector('smc-typing-indicator')).toBeTruthy();
  });

  it('does not show typing indicator when streaming is inactive', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-message-list />);

    expect(root.shadowRoot!.querySelector('smc-typing-indicator')).toBeNull();
  });
});

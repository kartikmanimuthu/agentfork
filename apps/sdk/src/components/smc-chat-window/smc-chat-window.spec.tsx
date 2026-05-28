import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcChatWindow } from './smc-chat-window';
import { SmcHeader } from '../smc-header/smc-header';
import { state, setConfig, setCsatPending, setPreChatDone, addMessage, setKbSuggestions, reset } from '../../store/widget-store';
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
  welcomeMessage: 'Hello!',
  inputPlaceholder: 'Ask me...',
  preChatForm: [{ field: 'name', type: 'text', required: true }],
  quickReplies: ['Hi'],
  proactiveRules: null,
  kbEnabled: false,
  fileUpload: false,
  csatEnabled: true,
  csatType: 'thumbs',
};

describe('SmcChatWindow', () => {
  beforeEach(() => {
    reset();
  });

  it('shows pre-chat form when preChatForm has items and preChatDone is false', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-chat-window />);

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('.chat-window')).toBeTruthy();
    expect(shadowRoot.querySelector('smc-pre-chat-form')).toBeTruthy();
    expect(shadowRoot.querySelector('smc-message-list')).toBeNull();
  });

  it('shows CSAT survey when csatEnabled, csatPending, and messages > 0', async () => {
    setConfig(mockConfig);
    setPreChatDone(true);
    setCsatPending(true);
    addMessage({
      id: 'msg_1',
      content: 'Hi',
      role: 'user',
      timestamp: new Date().toISOString(),
      status: 'sent',
    });

    const { root } = await render(<smc-chat-window />);

    expect(root.shadowRoot!.querySelector('smc-csat-survey')).toBeTruthy();
    expect(root.shadowRoot!.querySelector('smc-message-list')).toBeTruthy();
  });

  it('shows normal chat when no pre-chat and no CSAT', async () => {
    setConfig(mockConfig);
    setPreChatDone(true);

    const { root } = await render(<smc-chat-window />);

    expect(root.shadowRoot!.querySelector('smc-message-list')).toBeTruthy();
    expect(root.shadowRoot!.querySelector('smc-quick-replies')).toBeTruthy();
    expect(root.shadowRoot!.querySelector('smc-input-bar')).toBeTruthy();
  });

  it('shows KB suggestions when non-empty', async () => {
    setConfig(mockConfig);
    setPreChatDone(true);
    setKbSuggestions([{ id: '1', title: 'Help', snippet: '...' }]);

    const { root } = await render(<smc-chat-window />);

    expect(root.shadowRoot!.querySelector('smc-kb-suggestions')).toBeTruthy();
  });

  it('hides KB suggestions when empty', async () => {
    setConfig(mockConfig);
    setPreChatDone(true);

    const { root } = await render(<smc-chat-window />);

    expect(root.shadowRoot!.querySelector('smc-kb-suggestions')).toBeNull();
  });

  it('renders null when config is null', async () => {
    const { root } = await render(<smc-chat-window />);

    expect(root.shadowRoot!.querySelector('.chat-window')).toBeNull();
  });

  it('does not show pre-chat when preChatForm is empty array', async () => {
    setConfig({ ...mockConfig, preChatForm: [] });

    const { root } = await render(<smc-chat-window />);

    expect(root.shadowRoot!.querySelector('smc-pre-chat-form')).toBeNull();
  });
});

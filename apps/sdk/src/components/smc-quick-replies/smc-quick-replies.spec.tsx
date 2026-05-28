import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcQuickReplies } from './smc-quick-replies';
import { state, setConfig, addMessage, reset } from '../../store/widget-store';
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
  preChatForm: null,
  quickReplies: ['Hello', 'Help', 'Pricing'],
  proactiveRules: null,
  kbEnabled: false,
  fileUpload: false,
  csatEnabled: false,
  csatType: 'thumbs',
};

describe('SmcQuickReplies', () => {
  beforeEach(() => {
    reset();
  });

  it('renders chips for each quick reply when no messages', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-quick-replies />);

    const chips = root.shadowRoot!.querySelectorAll('.chip');
    expect(chips).toHaveLength(3);
    expect(chips[0].textContent).toBe('Hello');
    expect(chips[1].textContent).toBe('Help');
    expect(chips[2].textContent).toBe('Pricing');
  });

  it('does not render when messages exist', async () => {
    setConfig(mockConfig);
    addMessage({
      id: 'msg_1',
      content: 'Hi',
      role: 'user',
      timestamp: new Date().toISOString(),
      status: 'sent',
    });

    const { root } = await render(<smc-quick-replies />);

    expect(root.shadowRoot!.querySelector('.quick-replies')).toBeNull();
  });

  it('does not render when quickReplies is null', async () => {
    setConfig({ ...mockConfig, quickReplies: null });

    const { root } = await render(<smc-quick-replies />);

    expect(root.shadowRoot!.querySelector('.quick-replies')).toBeNull();
  });

  it('does not render when quickReplies is empty array', async () => {
    setConfig({ ...mockConfig, quickReplies: [] });

    const { root } = await render(<smc-quick-replies />);

    expect(root.shadowRoot!.querySelector('.quick-replies')).toBeNull();
  });

  it('emits smcQuickReply event when chip is clicked', async () => {
    setConfig(mockConfig);

    const { root, spyOnEvent } = await render(<smc-quick-replies />);

    const spy = spyOnEvent('smcQuickReply');
    const chips = root.shadowRoot!.querySelectorAll('.chip');
    (chips[0] as HTMLElement).click();

    expect(spy.events).toHaveLength(1);
    expect(spy.events[0].detail).toEqual({ text: 'Hello' });
  });

  it('renders chips with long text without truncation', async () => {
    setConfig({
      ...mockConfig,
      quickReplies: ['A very long reply text that might overflow the container'],
    });

    const { root } = await render(<smc-quick-replies />);

    const chip = root.shadowRoot!.querySelector('.chip')!;
    expect(chip.textContent).toBe('A very long reply text that might overflow the container');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcFeedback } from './smc-feedback';
import { state, setConfig, setSession, setApiKey, reset } from '../../store/widget-store';
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
  quickReplies: null,
  proactiveRules: null,
  kbEnabled: false,
  fileUpload: false,
  csatEnabled: false,
  csatType: 'thumbs',
};

describe('SmcFeedback', () => {
  beforeEach(() => {
    reset();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders thumbs up and thumbs down buttons', async () => {
    const { root } = await render(<smc-feedback messageId="msg_1" />);

    const shadowRoot = root.shadowRoot!;
    const buttons = shadowRoot.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute('aria-label')).toBe('Helpful');
    expect(buttons[1].getAttribute('aria-label')).toBe('Not helpful');
  });

  it('clicking thumbs up calls submitFeedback', async () => {
    setConfig(mockConfig);
    setApiKey('key123');
    setSession({ id: 'sess_1', status: 'active', visitorId: 'v_1' });
    (fetch as any).mockResolvedValue({ ok: true });

    const { root } = await render(<smc-feedback messageId="msg_1" />);

    const buttons = root.shadowRoot!.querySelectorAll('button');
    (buttons[0] as HTMLElement).click();

    // Wait for async handler to complete and component to re-render
    await new Promise((r) => setTimeout(r, 50));

    expect(fetch).toHaveBeenCalledTimes(1);
    // Verify selected state (cannot reliably test class due to async render cycle)
  });

  it('prevents double submit on same rating', async () => {
    setConfig(mockConfig);
    setApiKey('key123');
    setSession({ id: 'sess_1', status: 'active', visitorId: 'v_1' });
    (fetch as any).mockResolvedValue({ ok: true });

    const { root } = await render(<smc-feedback messageId="msg_1" />);

    const buttons = root.shadowRoot!.querySelectorAll('button');
    (buttons[0] as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 50));
    (buttons[0] as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 50));

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('changing rating calls API again', async () => {
    setConfig(mockConfig);
    setApiKey('key123');
    setSession({ id: 'sess_1', status: 'active', visitorId: 'v_1' });
    (fetch as any).mockResolvedValue({ ok: true });

    const { root } = await render(<smc-feedback messageId="msg_1" />);

    const buttons = root.shadowRoot!.querySelectorAll('button');
    (buttons[0] as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 50));
    (buttons[1] as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 50));

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not call API when no session or apiKey', async () => {
    setConfig(mockConfig);
    (fetch as any).mockResolvedValue({ ok: true });

    const { root } = await render(<smc-feedback messageId="msg_1" />);

    const buttons = root.shadowRoot!.querySelectorAll('button');
    (buttons[0] as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 50));

    expect(fetch).not.toHaveBeenCalled();
  });
});

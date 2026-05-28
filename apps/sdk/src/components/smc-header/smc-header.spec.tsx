import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcHeader } from './smc-header';
import { state, setConfig, setSession, setApiKey, addMessage, setCsatSubmitted, reset } from '../../store/widget-store';
import type { SdkWidgetConfig } from '../../types';

const mockConfig: SdkWidgetConfig = {
  agentId: 'agent_1',
  apiKeyPrefix: 'smc_abc',
  theme: 'light',
  primaryColor: '#ff0000',
  secondaryColor: '#00ff00',
  position: 'right',
  headerText: 'Chat Support',
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

describe('SmcHeader', () => {
  beforeEach(() => {
    reset();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('location', { origin: 'https://test.local' });
  });

  it('renders header text and Online status', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-header />);

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('.header')).toBeTruthy();
    expect(shadowRoot.querySelector('.header-title')!.textContent).toBe('Chat Support');
    expect(shadowRoot.querySelector('.header-status')!.textContent).toBe('Online');
  });

  it('renders avatar image when botAvatar is set', async () => {
    setConfig({ ...mockConfig, botAvatar: 'https://example.com/avatar.png' });

    const { root } = await render(<smc-header />);

    const img = root.shadowRoot!.querySelector('.avatar')!;
    expect(img.getAttribute('src')).toBe('https://example.com/avatar.png');
    expect(img.getAttribute('alt')).toBe('Bot');
  });

  it('renders placeholder SVG when botAvatar is null', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-header />);

    expect(root.shadowRoot!.querySelector('.avatar')).toBeNull();
    expect(root.shadowRoot!.querySelector('.avatar-placeholder svg')).toBeTruthy();
  });

  it('minimize button sets uiState', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-header />);

    const minimizeBtn = root.shadowRoot!.querySelector('[aria-label="Minimize"]') as HTMLElement;
    minimizeBtn.click();

    // Stencil batched update - wait for next render cycle
    await new Promise((r) => requestAnimationFrame(r));

    expect(state.uiState).toEqual({ open: false, minimized: true, hidden: false });
  });

  it('close without CSAT hides widget', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-header />);

    const closeBtn = root.shadowRoot!.querySelector('[aria-label="Close"]') as HTMLElement;
    closeBtn.click();

    await new Promise((r) => requestAnimationFrame(r));

    expect(state.uiState).toEqual({ open: false, minimized: false, hidden: true });
  });

  it('close with CSAT enabled + session + messages triggers CSAT flow', async () => {
    setConfig({ ...mockConfig, csatEnabled: true });
    setApiKey('key123');
    setSession({ id: 'sess_1', status: 'active', visitorId: 'v_1' });
    addMessage({
      id: 'msg_1',
      content: 'Hi',
      role: 'user',
      timestamp: new Date().toISOString(),
      status: 'sent',
    });
    (fetch as any).mockResolvedValue({ ok: true });

    const { root } = await render(<smc-header />);

    const closeBtn = root.shadowRoot!.querySelector('[aria-label="Close"]') as HTMLElement;
    closeBtn.click();

    // handleClose is async - wait for it to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(state.csatPending).toBe(true);
  });

  it('close with CSAT but csatSubmitted already true closes normally', async () => {
    setConfig({ ...mockConfig, csatEnabled: true });
    setSession({ id: 'sess_1', status: 'active', visitorId: 'v_1' });
    addMessage({
      id: 'msg_1',
      content: 'Hi',
      role: 'user',
      timestamp: new Date().toISOString(),
      status: 'sent',
    });
    setCsatSubmitted(true);

    const { root } = await render(<smc-header />);

    const closeBtn = root.shadowRoot!.querySelector('[aria-label="Close"]') as HTMLElement;
    closeBtn.click();

    await new Promise((r) => requestAnimationFrame(r));

    expect(state.uiState.hidden).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('close with CSAT but no session closes normally', async () => {
    setConfig({ ...mockConfig, csatEnabled: true });
    addMessage({
      id: 'msg_1',
      content: 'Hi',
      role: 'user',
      timestamp: new Date().toISOString(),
      status: 'sent',
    });

    const { root } = await render(<smc-header />);

    const closeBtn = root.shadowRoot!.querySelector('[aria-label="Close"]') as HTMLElement;
    closeBtn.click();

    await new Promise((r) => requestAnimationFrame(r));

    expect(state.uiState.hidden).toBe(true);
  });

  it('endSession failure is caught silently', async () => {
    setConfig({ ...mockConfig, csatEnabled: true });
    setApiKey('key123');
    setSession({ id: 'sess_1', status: 'active', visitorId: 'v_1' });
    addMessage({
      id: 'msg_1',
      content: 'Hi',
      role: 'user',
      timestamp: new Date().toISOString(),
      status: 'sent',
    });
    (fetch as any).mockRejectedValue(new Error('Network error'));

    const { root } = await render(<smc-header />);

    const closeBtn = root.shadowRoot!.querySelector('[aria-label="Close"]') as HTMLElement;
    closeBtn.click();

    await new Promise((r) => setTimeout(r, 50));

    expect(state.csatPending).toBe(true);
  });

  it('renders null when config is null', async () => {
    const { root } = await render(<smc-header />);

    expect(root.shadowRoot!.querySelector('.header')).toBeNull();
  });
});

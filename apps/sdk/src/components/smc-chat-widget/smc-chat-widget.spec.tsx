import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcChatWidget } from './smc-chat-widget';
import { SmcLauncher } from '../smc-launcher/smc-launcher';
import { state, reset } from '../../store/widget-store';

const mockConfig = {
  agentId: 'agent_1',
  apiKeyPrefix: 'smc_abc',
  theme: 'light' as const,
  primaryColor: '#ff0000',
  secondaryColor: '#00ff00',
  position: 'right' as const,
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
  csatType: 'thumbs' as const,
};

describe('SmcChatWidget', () => {
  beforeEach(() => {
    reset();
    vi.stubGlobal('fetch', vi.fn());
    // Mock successful config fetch
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    });
  });

  it('renders launcher when ready with config', async () => {
    const { root } = await render(
      <smc-chat-widget sdkId="test_sdk" apiUrl="https://api.example.com" />,
      { components: [SmcChatWidget, SmcLauncher] },
    );

    // Wait for componentWillLoad to complete
    await new Promise((r) => setTimeout(r, 50));

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('.smc-root')).toBeTruthy();
    expect(shadowRoot.querySelector('smc-launcher')).toBeTruthy();
  });

  it('renders error badge when config fetch fails', async () => {
    (fetch as any).mockRejectedValue(new Error('Network error'));

    const { root } = await render(
      <smc-chat-widget sdkId="test_sdk" apiUrl="https://api.example.com" />,
      { components: [SmcChatWidget] },
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(root.shadowRoot!.querySelector('.smc-error')).toBeTruthy();
    expect(root.shadowRoot!.querySelector('.error-badge')).toBeTruthy();
    expect(root.shadowRoot!.querySelector('.error-badge')!.getAttribute('title')).toBe('Network error');
  });

  it('renders chat window when open and not minimized', async () => {
    const { root } = await render(
      <smc-chat-widget sdkId="test_sdk" apiUrl="https://api.example.com" />,
      { components: [SmcChatWidget, SmcLauncher] },
    );

    await new Promise((r) => setTimeout(r, 50));

    // Set uiState to open
    state.uiState = { open: true, minimized: false, hidden: false };
    await new Promise((r) => requestAnimationFrame(r));

    expect(root.shadowRoot!.querySelector('smc-chat-window')).toBeTruthy();
  });

  it('does not render chat window when closed', async () => {
    const { root } = await render(
      <smc-chat-widget sdkId="test_sdk" apiUrl="https://api.example.com" />,
      { components: [SmcChatWidget, SmcLauncher] },
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(root.shadowRoot!.querySelector('smc-chat-window')).toBeNull();
  });

  it('does not render chat window when minimized', async () => {
    const { root } = await render(
      <smc-chat-widget sdkId="test_sdk" apiUrl="https://api.example.com" />,
      { components: [SmcChatWidget, SmcLauncher] },
    );

    await new Promise((r) => setTimeout(r, 50));

    state.uiState = { open: true, minimized: true, hidden: false };
    await new Promise((r) => requestAnimationFrame(r));

    expect(root.shadowRoot!.querySelector('smc-chat-window')).toBeNull();
  });

  it('sets CSS custom properties from config colors', async () => {
    const { root } = await render(
      <smc-chat-widget sdkId="test_sdk" apiUrl="https://api.example.com" />,
      { components: [SmcChatWidget] },
    );

    await new Promise((r) => setTimeout(r, 50));

    const style = root.shadowRoot!.querySelector('.smc-root')!.getAttribute('style');
    expect(style).toContain('--smc-primary: #ff0000');
    expect(style).toContain('--smc-secondary: #00ff00');
  });

  it('adds position class to root element', async () => {
    const { root } = await render(
      <smc-chat-widget sdkId="test_sdk" apiUrl="https://api.example.com" />,
      { components: [SmcChatWidget] },
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(root.shadowRoot!.querySelector('.position-right')).toBeTruthy();
  });

  it('uses apiUrl prop for baseUrl', async () => {
    const { root } = await render(
      <smc-chat-widget sdkId="test_sdk" apiUrl="https://custom.example.com" />,
      { components: [SmcChatWidget] },
    );

    await new Promise((r) => setTimeout(r, 50));

    // Fetch should be called with the custom URL
    const calls = (fetch as any).mock.calls;
    const configUrl = calls.find((c: string[]) => c[0].includes('/config'));
    expect(configUrl).toBeDefined();
    expect(configUrl[0]).toContain('https://custom.example.com/api/v1/sdk/test_sdk/config');
  });
});

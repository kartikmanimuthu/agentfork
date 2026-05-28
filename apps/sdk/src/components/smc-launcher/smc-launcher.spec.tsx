import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcLauncher } from './smc-launcher';
import { state, setConfig, setUiState, incrementUnread, setCsatSubmitted, reset } from '../../store/widget-store';
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

describe('SmcLauncher', () => {
  beforeEach(() => {
    reset();
  });

  it('renders chat icon when widget is closed', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-launcher />, {
      components: [SmcLauncher],
    });

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('.launcher-btn')).toBeTruthy();
    expect(shadowRoot.querySelector('.launcher-btn.open')).toBeNull();
    expect(shadowRoot.querySelector('svg')).toBeTruthy();
  });

  it('renders close icon when widget is open', async () => {
    setConfig(mockConfig);
    setUiState({ open: true });

    const { root } = await render(<smc-launcher />, {
      components: [SmcLauncher],
    });

    expect(root.shadowRoot!.querySelector('.launcher-btn.open')).toBeTruthy();
  });

  it('renders unread badge when count > 0 and closed', async () => {
    setConfig(mockConfig);
    incrementUnread();
    incrementUnread();
    incrementUnread();

    const { root } = await render(<smc-launcher />, {
      components: [SmcLauncher],
    });

    const badge = root.shadowRoot!.querySelector('.badge')!;
    expect(badge.textContent).toBe('3');
  });

  it('does not render unread badge when open', async () => {
    setConfig(mockConfig);
    incrementUnread();
    setUiState({ open: true });

    const { root } = await render(<smc-launcher />, {
      components: [SmcLauncher],
    });

    expect(root.shadowRoot!.querySelector('.badge')).toBeNull();
  });

  it('does not render unread badge when count is 0', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-launcher />, {
      components: [SmcLauncher],
    });

    expect(root.shadowRoot!.querySelector('.badge')).toBeNull();
  });

  it('clicking launcher when closed opens widget', async () => {
    setConfig(mockConfig);
    setCsatSubmitted(false);

    const { root } = await render(<smc-launcher />, {
      components: [SmcLauncher],
    });

    root.shadowRoot!.querySelector('.launcher-btn')!.click();

    expect(state.uiState).toEqual({ open: true, minimized: false, hidden: false });
    expect(state.unreadCount).toBe(0);
  });

  it('clicking launcher when open minimizes widget', async () => {
    setConfig(mockConfig);
    setUiState({ open: true });

    const { root } = await render(<smc-launcher />, {
      components: [SmcLauncher],
    });

    root.shadowRoot!.querySelector('.launcher-btn')!.click();

    expect(state.uiState).toEqual({ open: false, minimized: true, hidden: false });
  });

  it('clicking launcher when csatSubmitted resets CSAT first', async () => {
    setConfig(mockConfig);
    setCsatSubmitted(true);

    const { root } = await render(<smc-launcher />, {
      components: [SmcLauncher],
    });

    root.shadowRoot!.querySelector('.launcher-btn')!.click();

    expect(state.csatPending).toBe(false);
    expect(state.csatSubmitted).toBe(false);
  });

  it('proactive bubble renders with text and close button', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-launcher />, {
      components: [SmcLauncher],
    });

    // Set proactive message programmatically (as smc-proactive-engine does)
    const instance = root as any;
    instance.proactiveMessage = 'Hello there!';
    await new Promise((r) => requestAnimationFrame(r));

    const bubble = root.shadowRoot!.querySelector('.proactive-bubble')!;
    expect(bubble.querySelector('p')!.textContent).toBe('Hello there!');
  });

  it('close button on proactive bubble dismisses without opening chat', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-launcher />, {
      components: [SmcLauncher],
    });

    const instance = root as any;
    instance.proactiveMessage = 'Hello!';
    await new Promise((r) => requestAnimationFrame(r));

    const closeBtn = root.shadowRoot!.querySelector('.proactive-close')!;
    closeBtn.click();

    // Widget should NOT open
    expect(state.uiState.open).toBe(false);
  });

  it('renders null when config is null', async () => {
    const { root } = await render(<smc-launcher />, {
      components: [SmcLauncher],
    });

    expect(root.shadowRoot!.querySelector('.launcher-container')).toBeNull();
  });
});

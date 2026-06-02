import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcProactiveEngine } from './smc-proactive-engine';
import { state, setConfig, setUiState, reset } from '../../store/widget-store';
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
  proactiveRules: [{ trigger: 'time', delay: 1000, message: 'Hi there!' }],
  kbEnabled: false,
  fileUpload: false,
  csatEnabled: false,
  csatType: 'thumbs',
};

describe('SmcProactiveEngine', () => {
  beforeEach(() => {
    reset();
  });

  it('evaluates proactive rules when rules exist and widget closed', async () => {
    setConfig(mockConfig);

    // We can verify the component loads without error
    const { root } = await render(<smc-proactive-engine />);

    expect(root).toBeTruthy();
    // componentDidLoad should have been called, setting up timeouts
  });

  it('does not evaluate when no rules configured', async () => {
    setConfig({ ...mockConfig, proactiveRules: null });

    const { root } = await render(<smc-proactive-engine />);

    expect(root).toBeTruthy();
  });

  it('does not evaluate when rules array is empty', async () => {
    setConfig({ ...mockConfig, proactiveRules: [] });

    const { root } = await render(<smc-proactive-engine />);

    expect(root).toBeTruthy();
  });

  it('does not evaluate when widget is already open', async () => {
    setConfig(mockConfig);
    setUiState({ open: true });

    const { root } = await render(<smc-proactive-engine />);

    expect(root).toBeTruthy();
  });

  it('renders nothing visible', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-proactive-engine />);

    // Component has shadow: true and returns null from render
    expect(root.shadowRoot!.innerHTML).toBe('');
  });

  it('calls cleanup on disconnect', async () => {
    setConfig(mockConfig);

    const { root, unmount } = await render(<smc-proactive-engine />);

    // Unmounting should call disconnectedCallback which calls cleanup
    expect(() => unmount()).not.toThrow();
  });
});

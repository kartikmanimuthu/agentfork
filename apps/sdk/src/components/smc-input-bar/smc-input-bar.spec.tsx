import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcInputBar } from './smc-input-bar';
import { SmcMessage } from '../smc-message/smc-message';
import { SmcMarkdown } from '../smc-markdown/smc-markdown';
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

describe('SmcInputBar', () => {
  beforeEach(() => {
    reset();
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(document, 'querySelector').mockReturnValue({ sdkId: 'test_sdk_id' } as any);
  });

  it('renders textarea with placeholder from config', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-input-bar />);

    const textarea = root.shadowRoot!.querySelector('textarea')!;
    expect(textarea.placeholder).toBe('Ask me...');
  });

  it('renders default placeholder when config value is null', async () => {
    setConfig({ ...mockConfig, inputPlaceholder: null as any });

    const { root } = await render(<smc-input-bar />);

    const textarea = root.shadowRoot!.querySelector('textarea')!;
    expect(textarea.placeholder).toBe('Write a message...');
  });

  it('send button is disabled when textarea is empty', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-input-bar />);

    const sendBtn = root.shadowRoot!.querySelector('.send-btn')!;
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('Enter key sends message', async () => {
    setConfig(mockConfig);
    setApiKey('key123');
    setSession({ id: 'sess_1', status: 'active', visitorId: 'v_1' });
    (fetch as any).mockResolvedValue(new Response());

    const { root } = await render(<smc-input-bar />);

    const textarea = root.shadowRoot!.querySelector('textarea')!;
    textarea.value = 'Hello';
    textarea.dispatchEvent(new Event('input'));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false }));

    // Wait for async send to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(state.messages.length).toBeGreaterThan(0);
    expect(state.messages[0].role).toBe('user');
  });

  it('Shift+Enter does not send', async () => {
    setConfig(mockConfig);
    setApiKey('key123');
    setSession({ id: 'sess_1', status: 'active', visitorId: 'v_1' });

    const { root } = await render(<smc-input-bar />);

    const textarea = root.shadowRoot!.querySelector('textarea')!;
    textarea.value = 'Hello';
    textarea.dispatchEvent(new Event('input'));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));

    expect(state.messages).toHaveLength(0);
  });

  it('file upload button shown when fileUpload is true', async () => {
    setConfig({ ...mockConfig, fileUpload: true });

    const { root } = await render(<smc-input-bar />);

    expect(root.shadowRoot!.querySelector('.attach-btn')).toBeTruthy();
  });

  it('file upload button hidden when fileUpload is false', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-input-bar />);

    expect(root.shadowRoot!.querySelector('.attach-btn')).toBeNull();
  });

  it('does not send when text is only whitespace', async () => {
    setConfig(mockConfig);
    setApiKey('key123');
    setSession({ id: 'sess_1', status: 'active', visitorId: 'v_1' });

    const { root } = await render(<smc-input-bar />);

    const textarea = root.shadowRoot!.querySelector('textarea')!;
    textarea.value = '   ';
    textarea.dispatchEvent(new Event('input'));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false }));

    expect(state.messages).toHaveLength(0);
  });

  it('does not send when no apiKey', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-input-bar />);

    const textarea = root.shadowRoot!.querySelector('textarea')!;
    textarea.value = 'Hello';
    textarea.dispatchEvent(new Event('input'));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false }));

    expect(state.messages).toHaveLength(0);
  });

  it('auto-creates session on first send', async () => {
    setConfig(mockConfig);
    setApiKey('key123');
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'sess_new' }) })
      .mockResolvedValueOnce(new Response());

    const { root } = await render(<smc-input-bar />);

    const textarea = root.shadowRoot!.querySelector('textarea')!;
    textarea.value = 'Hello';
    textarea.dispatchEvent(new Event('input'));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false }));

    await new Promise((r) => setTimeout(r, 50));

    expect(state.session).not.toBeNull();
    expect(state.session!.id).toBe('sess_new');
  });
});

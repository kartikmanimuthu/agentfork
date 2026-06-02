import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@stencil/vitest';
import { h } from '@stencil/core';
import { SmcCsatSurvey } from './smc-csat-survey';
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
  csatEnabled: true,
  csatType: 'thumbs',
};

describe('SmcCsatSurvey', () => {
  beforeEach(() => {
    reset();
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(document, 'querySelector').mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders thumbs up/down when csatType is thumbs', async () => {
    setConfig(mockConfig);

    const { root } = await render(<smc-csat-survey />);

    const shadowRoot = root.shadowRoot!;
    expect(shadowRoot.querySelector('.csat')).toBeTruthy();
    expect(shadowRoot.querySelector('.thumbs')).toBeTruthy();
    expect(shadowRoot.querySelector('.stars')).toBeNull();
    expect(shadowRoot.querySelector('.csat-prompt')!.textContent).toBe('How was your experience?');
  });

  it('renders 5 stars when csatType is stars', async () => {
    setConfig({ ...mockConfig, csatType: 'stars' });

    const { root } = await render(<smc-csat-survey />);

    const stars = root.shadowRoot!.querySelectorAll('.star');
    expect(stars).toHaveLength(5);
  });

  it('renders stars when csatType is nps (falls through to else)', async () => {
    setConfig({ ...mockConfig, csatType: 'nps' });

    const { root } = await render(<smc-csat-survey />);

    const stars = root.shadowRoot!.querySelectorAll('.star');
    expect(stars).toHaveLength(5);
  });

  it('does not render when csatEnabled is false', async () => {
    setConfig({ ...mockConfig, csatEnabled: false });

    const { root } = await render(<smc-csat-survey />);

    expect(root.shadowRoot!.querySelector('.csat')).toBeNull();
  });

  it('clicking rating shows thank you message', async () => {
    setConfig(mockConfig);
    setApiKey('key123');
    setSession({ id: 'sess_1', status: 'active', visitorId: 'v_1' });
    (state as any).baseUrl = 'https://test.local';
    (fetch as any).mockResolvedValue({ ok: true });

    const { root } = await render(<smc-csat-survey />);

    const thumbsUp = root.shadowRoot!.querySelector('.thumb') as HTMLElement;
    thumbsUp.click();

    // Wait for the async handler + 1500ms timeout
    await new Promise((r) => setTimeout(r, 100));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(root.shadowRoot!.querySelector('.thanks')).toBeTruthy();
  });

  it('clicking rating on stars type shows thank you and sets csatSubmitted', async () => {
    setConfig({ ...mockConfig, csatType: 'stars' });
    setApiKey('key123');
    setSession({ id: 'sess_1', status: 'active', visitorId: 'v_1' });
    (state as any).baseUrl = 'https://test.local';
    (fetch as any).mockResolvedValue({ ok: true });

    const { root } = await render(<smc-csat-survey />);

    const stars = root.shadowRoot!.querySelectorAll('.star');
    (stars[2] as HTMLElement).click(); // Click 3rd star

    // Wait for async handler + CSAT 1500ms timeout
    await new Promise((r) => setTimeout(r, 100));

    expect(root.shadowRoot!.querySelector('.thanks')).toBeTruthy();
    expect(state.csatSubmitted).toBe(true);
  });
});

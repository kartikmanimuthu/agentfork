import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetRaw = vi.fn();

vi.mock('@chatbot/shared', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  TenantConfigService: vi.fn(),
  EncryptionService: vi.fn(),
}));

vi.mock('../config-service', () => ({
  ClawConnectorConfigService: vi.fn().mockImplementation(() => ({ getRaw: mockGetRaw })),
}));

import { SlackConnector } from './slack';
import { TelegramConnector } from './telegram';

function mockFetchJson(body: unknown) {
  return vi.fn().mockResolvedValue({ json: async () => body });
}

describe('SlackConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRaw.mockResolvedValue(null);
  });

  it('declares callback delivery and full HIL support', () => {
    const c = new SlackConnector();
    expect(c.channelType).toBe('slack');
    expect(c.deliveryMode).toBe('callback');
    expect(c.hilCapabilities).toEqual({
      clarification: true,
      approvalButtons: true,
      threadedReplies: true,
    });
  });

  it('fails fast without a token instead of calling Slack', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await new SlackConnector().verifyCredentials('t1');
    expect(result).toEqual({ ok: false, error: expect.stringContaining('bot token is required') });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('verifies a token supplied in the form before it has been saved', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ ok: true, team: 'Acme', team_id: 'T1', user: 'claw' }));

    const result = await new SlackConnector().verifyCredentials('t1', { botToken: 'xoxb-typed' });
    expect(result).toMatchObject({ ok: true, meta: { team: 'Acme', teamId: 'T1', botUser: 'claw' } });
    expect(result.ok && result.detail).toContain('Acme');
    // The stored config should not be consulted when an override is provided.
    expect(mockGetRaw).not.toHaveBeenCalled();
  });

  it('falls back to the stored token when the form field is blank', async () => {
    mockGetRaw.mockResolvedValue({ enabled: true, signingSecret: 's', botToken: 'xoxb-stored' });
    const fetchSpy = mockFetchJson({ ok: true, team: 'Acme', user: 'claw' });
    vi.stubGlobal('fetch', fetchSpy);

    await new SlackConnector().verifyCredentials('t1', { botToken: '   ' });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://slack.com/api/auth.test',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer xoxb-stored' }) }),
    );
  });

  it('treats Slack\'s 200-with-ok:false as a failed credential', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ ok: false, error: 'invalid_auth' }));

    const result = await new SlackConnector().verifyCredentials('t1', { botToken: 'xoxb-bad' });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('invalid_auth') });
  });

  it('reports a network failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const result = await new SlackConnector().verifyCredentials('t1', { botToken: 'xoxb-x' });
    expect(result).toEqual({ ok: false, error: 'ECONNREFUSED' });
  });

  it('reports a timeout in plain language', async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));

    const result = await new SlackConnector().verifyCredentials('t1', { botToken: 'xoxb-x' });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('10 seconds') });
  });
});

describe('TelegramConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRaw.mockResolvedValue(null);
  });

  it('declares streaming delivery and full HIL support', () => {
    const c = new TelegramConnector();
    expect(c.channelType).toBe('telegram');
    expect(c.deliveryMode).toBe('streaming');
    expect(c.hilCapabilities.approvalButtons).toBe(true);
  });

  it('verifies via getMe and reports the bot username', async () => {
    const fetchSpy = mockFetchJson({ ok: true, result: { username: 'claw_bot' } });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await new TelegramConnector().verifyCredentials('t1', { botToken: '123:ABC' });
    expect(result).toMatchObject({ ok: true, detail: 'Connected as @claw_bot' });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.telegram.org/bot123:ABC/getMe',
      expect.anything(),
    );
  });

  it('surfaces Telegram\'s rejection description', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ ok: false, description: 'Unauthorized' }));

    const result = await new TelegramConnector().verifyCredentials('t1', { botToken: 'bad' });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('Unauthorized') });
  });

  it('fails fast without a token', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await new TelegramConnector().verifyCredentials('t1');
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

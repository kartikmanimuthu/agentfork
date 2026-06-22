import { describe, it, expect } from 'vitest';
import { TelegramCommandHandler } from './command-handler';

describe('TelegramCommandHandler', () => {
  const handler = new TelegramCommandHandler();

  it('detects /reset', () => {
    expect(handler.parse('/reset')).toEqual({ type: 'reset' });
  });

  it('detects /help', () => {
    expect(handler.parse('/help')).toEqual({ type: 'help' });
  });

  it('detects /start', () => {
    expect(handler.parse('/start')).toEqual({ type: 'help' });
  });

  it('returns null for plain text', () => {
    expect(handler.parse('hello')).toBeNull();
  });
});

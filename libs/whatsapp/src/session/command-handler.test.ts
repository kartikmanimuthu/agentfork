import { describe, it, expect } from 'vitest';
import { CommandHandler } from './command-handler';

describe('CommandHandler', () => {
  const handler = new CommandHandler();

  it('detects /reset command', () => {
    const result = handler.parse('/reset');
    expect(result).toEqual({ type: 'reset' });
  });

  it('detects /switch command with agent name', () => {
    const result = handler.parse('/switch sales');
    expect(result).toEqual({ type: 'switch', agentName: 'sales' });
  });

  it('detects /help command', () => {
    const result = handler.parse('/help');
    expect(result).toEqual({ type: 'help' });
  });

  it('returns null for non-command messages', () => {
    const result = handler.parse('Hello, I need help');
    expect(result).toBeNull();
  });

  it('returns null for messages starting with / but not a known command', () => {
    const result = handler.parse('/unknown');
    expect(result).toBeNull();
  });

  it('is case-insensitive', () => {
    const result = handler.parse('/RESET');
    expect(result).toEqual({ type: 'reset' });
  });

  it('trims whitespace', () => {
    const result = handler.parse('  /help  ');
    expect(result).toEqual({ type: 'help' });
  });

  it('handles /switch without agent name', () => {
    const result = handler.parse('/switch');
    expect(result).toEqual({ type: 'switch', agentName: undefined });
  });
});

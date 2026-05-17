import { describe, it, expect } from 'vitest';
import { KeywordRouter } from './keyword-router';
import type { RoutingContext } from './router.interface';

function makeContext(overrides: Partial<RoutingContext> = {}): RoutingContext {
  return {
    message: { from: '15559876543', id: 'wamid.1', timestamp: '1', type: 'text', text: { body: 'I need sales help' } },
    contactPhone: '15559876543',
    contactName: 'John',
    accountId: 'acc_1',
    routing: { strategy: 'keyword', config: {}, fallbackAgentId: 'agent_fallback' },
    rules: [
      { agentId: 'agent_sales', priority: 0, condition: { type: 'keyword', value: 'sales' }, isActive: true },
      { agentId: 'agent_support', priority: 1, condition: { type: 'keyword', value: 'support' }, isActive: true },
    ],
    ...overrides,
  };
}

describe('KeywordRouter', () => {
  const router = new KeywordRouter();

  it('routes to agent matching keyword', async () => {
    const result = await router.route(makeContext());
    expect(result).toEqual({ type: 'resolved', agentId: 'agent_sales' });
  });

  it('matches case-insensitively', async () => {
    const ctx = makeContext({
      message: { from: '1', id: 'w.1', timestamp: '1', type: 'text', text: { body: 'SALES please' } },
    });
    const result = await router.route(ctx);
    expect(result).toEqual({ type: 'resolved', agentId: 'agent_sales' });
  });

  it('respects priority order', async () => {
    const ctx = makeContext({
      message: { from: '1', id: 'w.1', timestamp: '1', type: 'text', text: { body: 'sales and support' } },
    });
    const result = await router.route(ctx);
    expect(result).toEqual({ type: 'resolved', agentId: 'agent_sales' });
  });

  it('falls back when no keyword matches', async () => {
    const ctx = makeContext({
      message: { from: '1', id: 'w.1', timestamp: '1', type: 'text', text: { body: 'hello there' } },
    });
    const result = await router.route(ctx);
    expect(result).toEqual({ type: 'fallback', agentId: 'agent_fallback', reason: 'no keyword matched' });
  });

  it('skips inactive rules', async () => {
    const ctx = makeContext({
      message: { from: '1', id: 'w.1', timestamp: '1', type: 'text', text: { body: 'sales' } },
      rules: [
        { agentId: 'agent_sales', priority: 0, condition: { type: 'keyword', value: 'sales' }, isActive: false },
        { agentId: 'agent_support', priority: 1, condition: { type: 'keyword', value: 'support' }, isActive: true },
      ],
    });
    const result = await router.route(ctx);
    expect(result).toEqual({ type: 'fallback', agentId: 'agent_fallback', reason: 'no keyword matched' });
  });

  it('supports multiple keywords via values array', async () => {
    const ctx = makeContext({
      message: { from: '1', id: 'w.1', timestamp: '1', type: 'text', text: { body: 'billing issue' } },
      rules: [
        { agentId: 'agent_billing', priority: 0, condition: { type: 'keyword', values: ['billing', 'invoice', 'payment'] }, isActive: true },
      ],
    });
    const result = await router.route(ctx);
    expect(result).toEqual({ type: 'resolved', agentId: 'agent_billing' });
  });

  it('throws when no match and no fallback', async () => {
    const ctx = makeContext({
      message: { from: '1', id: 'w.1', timestamp: '1', type: 'text', text: { body: 'hello' } },
      routing: { strategy: 'keyword', config: {}, fallbackAgentId: null },
    });
    await expect(router.route(ctx)).rejects.toThrow('No routing rule matched and no fallback agent configured');
  });
});

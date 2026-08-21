import { describe, it, expect } from 'vitest';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { budgetTools, toolGroupOf } from './tool-budget';

/** A tool whose schema size is controllable, so budgets can be pinned exactly. */
const fake = (name: string, padding = 0) =>
  tool(async () => 'ok', {
    name,
    description: 'd'.repeat(Math.max(1, padding)),
    schema: z.object({ q: z.string().optional() }),
  });

describe('toolGroupOf', () => {
  it('classifies browser tools as the lowest-priority group', () => {
    expect(toolGroupOf('browser_click')).toBe('browser');
    expect(toolGroupOf('browser_open_url')).toBe('browser');
  });

  it('classifies the tools Claw cannot work without as core', () => {
    for (const name of ['get_current_time', 'search_memory', 'save_memory', 'read_workspace_file', 'load_skill']) {
      expect(toolGroupOf(name)).toBe('core');
    }
  });

  it('classifies web and everything else', () => {
    expect(toolGroupOf('web_search')).toBe('web');
    expect(toolGroupOf('web_fetch')).toBe('web');
    expect(toolGroupOf('google_calendar_list_events')).toBe('integration');
    // Only the `mcp_` PREFIX marks a tenant's MCP tool. `some_mcp_thing` merely
    // contains the substring and is a built-in integration like any other.
    expect(toolGroupOf('some_mcp_thing')).toBe('integration');
  });

  // A tenant deliberately registered these and the prompt advertises them by
  // name; a built-in integration nobody asked for did not earn the same
  // protection. Under `integration` they were the FIRST thing dropped after the
  // browser, so on a small-window provider the "What is connected to you"
  // section still promised `mcp_grafana_*` while the tools themselves were gone.
  it('gives a tenant\'s own MCP tools their own group, not the integration pool', () => {
    expect(toolGroupOf('mcp_smc_chatbot_get_funds_data')).toBe('mcp');
    expect(toolGroupOf('mcp_grafana_query_loki')).toBe('mcp');
  });
});

describe('drop order', () => {
  // Sized in units of one tool's measured schema cost rather than a guessed
  // token count, so the thresholds stay exact if the serializer's overhead
  // changes. `schemaFraction: 1` takes the 0.45 share out of the arithmetic.
  const surface = () => [
    fake('get_current_time', 400), fake('web_search', 400),
    fake('gmail_send_message', 400), fake('mcp_grafana_query_loki', 400),
    fake('browser_click', 400),
  ];
  const unit = budgetTools([fake('get_current_time', 400)], { inputBudget: 1e6 }).schemaTokensBefore;
  /** A budget that forces exactly `keep` of the five tools to survive. */
  const room = (keep: number) => ({ inputBudget: unit * keep + Math.floor(unit / 2), schemaFraction: 1 });

  it('drops browser first, keeping web, integrations and MCP', () => {
    const r = budgetTools(surface(), room(4));
    expect(r.dropped.map((d) => d.name)).toEqual(['browser_click']);
  });

  it("drops built-in integrations before a tenant's MCP tools", () => {
    const r = budgetTools(surface(), room(3));
    const dropped = r.dropped.map((d) => d.name);
    expect(dropped).toContain('gmail_send_message');
    expect(dropped).not.toContain('mcp_grafana_query_loki');
  });

  it('drops MCP only after web search has already gone', () => {
    const r = budgetTools(surface(), room(1));
    const dropped = r.dropped.map((d) => d.name);
    expect(dropped).toContain('web_search');
    expect(dropped).toContain('mcp_grafana_query_loki');
    expect(r.tools.map((t) => t.name)).toEqual(['get_current_time']);
  });
});

describe('budgetTools', () => {
  it('keeps every tool when the schemas already fit', () => {
    const tools = [fake('get_current_time'), fake('web_search'), fake('browser_click')];
    const result = budgetTools(tools, { inputBudget: 200_000 });
    expect(result.tools).toHaveLength(3);
    expect(result.dropped).toEqual([]);
  });

  // The real failure this exists to prevent: 102 tools serialized to 76KB of
  // schemas — about 19k tokens — against a model whose whole context window is
  // 16k. No compaction can help, because tool schemas ride on every call and are
  // not part of the message history.
  it('drops browser tools first when the schemas do not fit', () => {
    const tools = [fake('get_current_time', 200), fake('browser_click', 4000), fake('browser_type', 4000)];
    const result = budgetTools(tools, { inputBudget: 1_000 });
    expect(result.tools.map((t) => t.name)).toEqual(['get_current_time']);
    expect(result.dropped.map((d) => d.name).sort()).toEqual(['browser_click', 'browser_type']);
  });

  it('drops integrations only after browser tools are already gone', () => {
    const tools = [fake('get_current_time', 100), fake('jira_create_issue', 4000), fake('browser_click', 4000)];
    const result = budgetTools(tools, { inputBudget: 1_200 });
    const kept = result.tools.map((t) => t.name);
    expect(kept).toContain('get_current_time');
    expect(kept).not.toContain('browser_click');
    // browser went first; whether jira also had to go depends on the budget, but
    // it must never be dropped while a browser tool survives.
    if (kept.includes('jira_create_issue')) {
      expect(result.dropped.map((d) => d.name)).toEqual(['browser_click']);
    }
  });

  it('never drops core tools, even when they alone exceed the budget', () => {
    const tools = [fake('get_current_time', 20_000), fake('search_memory', 20_000)];
    const result = budgetTools(tools, { inputBudget: 100 });
    expect(result.tools.map((t) => t.name).sort()).toEqual(['get_current_time', 'search_memory']);
    expect(result.overBudgetAfterTrim).toBe(true);
  });

  it('reports the schema cost so the drop is never silent', () => {
    const tools = [fake('get_current_time', 100), fake('browser_click', 8000)];
    const result = budgetTools(tools, { inputBudget: 1_000 });
    expect(result.schemaTokensBefore).toBeGreaterThan(result.schemaTokensAfter);
    expect(result.limitTokens).toBeGreaterThan(0);
  });

  it('handles an empty tool list', () => {
    const result = budgetTools([], { inputBudget: 9_904 });
    expect(result.tools).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.overBudgetAfterTrim).toBe(false);
  });
});

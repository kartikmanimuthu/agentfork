import { describe, it, expect } from 'vitest';
import { buildLiveCapabilityIndex, suppressesLiveCapability, filterSuppressiveRules } from './live-capability-gate';
import type { ProceduralValue } from './types';

/** The tenant's real surface at the time the bug was reported. */
const live = buildLiveCapabilityIndex({
  toolNames: [
    'mcp_smc_chatbot_get_funds_data',
    'mcp_smc_chatbot_get_server_info',
    'mcp_smc_chatbot_get_health_status',
    'gmail_send_message',
    'web_search',
  ],
  servers: [{ name: 'smc-chatbot', slug: 'smc_chatbot' }],
});

/** The two rules that produced the reported answer, verbatim from claw_memories. */
const askBeforeCalling: ProceduralValue = {
  trigger: 'Any MCP tool call requiring authentication credentials not present in memory',
  evidence: 'Agent called get_funds_data with blank credentials',
  confidence: 'medium',
  instruction:
    "Do not invoke data-fetching MCP tools (e.g., get_funds_data) with empty or placeholder credentials just to 'test' behavior. Instead, first check get_server_info/memory for required auth fields (x_access_token, x_client_id, x_platform) and ask the user for real values before calling.",
};

const neverInvoke: ProceduralValue = {
  trigger: 'Any request to fetch financial data (funds, positions, holdings, ledger) via SMC-Financial-Data-MCP when credentials are not already in memory',
  evidence: 'Agent called get_funds_data with empty credentials as a non-genuine attempt',
  confidence: 'high',
  instruction:
    'Never invoke SMC-Financial-Data-MCP data-fetching tools (e.g., get_funds_data) with empty or placeholder credentials to ‘test’ behavior. Instead, ask the user directly for x_access_token, x_client_id, and x_platform before making the call.',
};

// Fires only once a call has already been made, so it cannot stop the first one.
const afterFailure: ProceduralValue = {
  trigger: 'MCP tool call fails with an authentication/credential error',
  evidence: 'Agent repeated get_funds_data across many turns, hitting the same auth error',
  confidence: 'high',
  instruction:
    'When an MCP tool call fails due to missing/invalid authentication credentials (e.g., x_access_token), do not repeatedly retry the same call across multiple turns. Immediately and clearly ask the user for the specific missing credentials once, then stop until they are provided.',
};

const driveFallback: ProceduralValue = {
  trigger: 'Google Drive search/list calls fail with expired/revoked OAuth error',
  evidence: 'Agent used this fallback across sessions',
  confidence: 'medium',
  instruction:
    'When Google Drive access fails due to expired/revoked credentials, fall back to searching Notion and Gmail, and surface the blocker to the user.',
};

const unrelated: ProceduralValue = {
  trigger: 'user requests creating a JIRA ticket and no JIRA MCP tool exists',
  evidence: 'Session had no JIRA tool',
  confidence: 'high',
  instruction: 'Never invoke a jira_create_issue tool that is not present; draft the ticket and save it to memory instead.',
};

describe('buildLiveCapabilityIndex', () => {
  it('indexes an MCP tool under its bare name as well as its namespaced one', () => {
    // Memories were written when the model saw `get_funds_data`; the bound tool
    // is `mcp_smc_chatbot_get_funds_data`. Without the bare form nothing matches.
    expect(live.has('get_funds_data')).toBe(true);
    expect(live.has('mcp_smc_chatbot_get_funds_data')).toBe(true);
    expect(live.has('smc-chatbot')).toBe(true);
  });

  it('skips tokens too short to match anything meaningfully', () => {
    const idx = buildLiveCapabilityIndex({ toolNames: ['ls', 'task'], servers: [] });
    expect(idx.size).toBe(0);
  });
});

describe('suppressesLiveCapability', () => {
  // The reported bug: with all 7 tools bound, the model rendered
  // x_access_token / x_client_id / x_platform as a table for the user and made
  // zero tool calls. These two rules are what it was obeying.
  it('flags a rule that says ask the user instead of calling a live tool', () => {
    expect(suppressesLiveCapability(askBeforeCalling, live)).toBe(true);
    expect(suppressesLiveCapability(neverInvoke, live)).toBe(true);
  });

  // The whole point of the distinction: a rule triggered BY a failure cannot
  // have prevented the call that failed, and dropping it brings back the
  // retry-the-same-call-forever loop it was learned to stop.
  it('keeps a rule whose trigger is a failure that has already happened', () => {
    expect(suppressesLiveCapability(afterFailure, live)).toBe(false);
    expect(suppressesLiveCapability(driveFallback, live)).toBe(false);
  });

  // Advice about a tool the tenant does not have cannot suppress a live call.
  it('keeps a discouraging rule that names nothing connected this turn', () => {
    expect(suppressesLiveCapability(unrelated, live)).toBe(false);
  });

  it('keeps everything when the turn has no live capabilities at all', () => {
    const empty = buildLiveCapabilityIndex({ toolNames: [], servers: [] });
    expect(suppressesLiveCapability(neverInvoke, empty)).toBe(false);
  });
});

describe('filterSuppressiveRules', () => {
  it('returns the survivors and names what it dropped', () => {
    const { kept, suppressed } = filterSuppressiveRules(
      [askBeforeCalling, afterFailure, neverInvoke, unrelated],
      live,
    );
    expect(kept).toEqual([afterFailure, unrelated]);
    expect(suppressed).toHaveLength(2);
    expect(suppressed[0]).toContain('Any MCP tool call requiring authentication');
  });

  it('is a no-op on an empty rule list', () => {
    expect(filterSuppressiveRules([], live)).toEqual({ kept: [], suppressed: [] });
  });
});

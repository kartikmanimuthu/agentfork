/**
 * live-capability-gate.ts — stops a learned rule from talking Claw out of a
 * tool it actually has this turn.
 *
 * The failure this exists for, in full. A tenant registered one MCP server
 * (`smc-chatbot`, 7 tools). Everything downstream worked: the server connected,
 * all 7 tools bound, `budgetTools` dropped none of them, and
 * `connectedCapabilitiesSection` named the server and its `mcp_smc_chatbot_*`
 * prefix in the system prompt. Asked "name all my sc2 services using mcp", the
 * model made ONE model call, ZERO tool calls, and replied "I need the
 * credentials to talk to the MCP endpoint", rendering x_access_token /
 * x_client_id / x_platform as a table for the user to fill in.
 *
 * It was obeying itself. Two PROCEDURAL memories, learned during earlier
 * sessions when the credentials genuinely were missing, said so outright:
 *
 *   "Never invoke SMC-Financial-Data-MCP data-fetching tools … Instead, ask the
 *    user directly for x_access_token, x_client_id, and x_platform before
 *    making the call."
 *
 * `memory-middleware.ts`'s `wrapModelCall` splices recalled rules into the
 * system message of every model call, so that instruction arrived alongside the
 * tools it was telling the model not to use. The caveat in `memorySection`
 * ("trust your actual tools over this") is a hedge; an imperative rule under
 * "Operating rules (learned)" reads as policy, and a 20b model follows the
 * policy. Measured: the same question with those rules injected called a tool in
 * 9 of 13 runs; without them, 5 of 5.
 *
 * WHAT IS AND IS NOT DROPPED
 *
 * Only a rule that is BOTH discouraging AND about something live right now. A
 * rule naming a tool this tenant does not have cannot suppress a call that was
 * never possible, so it stays.
 *
 * Crucially, a rule whose TRIGGER is a failure survives regardless. "When an MCP
 * tool call fails with an auth error, ask once and stop retrying" cannot prevent
 * a first call — by the time it fires, the call has already happened and failed.
 * That rule was learned because the agent retried the same failing call across
 * many turns; dropping it would trade one bug for the one it replaced. The
 * distinction between "ask BEFORE calling" and "ask AFTER it failed" is the
 * whole design of this module, and it is drawn on the trigger, not the
 * instruction.
 */

import { createLogger } from '@chatbot/shared';
import type { ProceduralValue } from './types';

const logger = createLogger('claw-studio:live-capability-gate');

/**
 * Below this length a token matches by accident. `ls`, `task` and `edit` are
 * real tool names that appear as ordinary words in almost any instruction text.
 */
const MIN_TOKEN_LENGTH = 5;

export interface LiveCapabilities {
  /** Every tool name bound for this turn, after the budget trim. */
  toolNames: string[];
  /** MCP servers reachable this turn, so a rule may name the server instead of a tool. */
  servers: Array<{ name: string; slug: string }>;
}

/**
 * The lowercase names a recalled rule might use to refer to something live.
 *
 * Includes each MCP tool's BARE name as well as its namespaced one: the rules in
 * question were written when the model was looking at `get_funds_data`, while
 * the bound tool is `mcp_smc_chatbot_get_funds_data`. Indexing only the wire
 * name would match nothing and the gate would never fire.
 */
export function buildLiveCapabilityIndex(cap: LiveCapabilities): Set<string> {
  const index = new Set<string>();
  const add = (raw: string | undefined) => {
    const token = raw?.trim().toLowerCase();
    if (token && token.length >= MIN_TOKEN_LENGTH) index.add(token);
  };

  for (const server of cap.servers ?? []) {
    add(server.name);
    add(server.slug);
  }
  for (const name of cap.toolNames ?? []) {
    add(name);
    for (const server of cap.servers ?? []) {
      const prefix = `mcp_${server.slug}_`;
      if (name.startsWith(prefix)) add(name.slice(prefix.length));
    }
  }
  return index;
}

/**
 * A trigger that can only fire once a call has already been made and failed.
 * Matched on the trigger alone — an instruction routinely mentions failure while
 * describing what to avoid, which is not the same thing.
 */
const POST_FAILURE_TRIGGER = /\b(fail|fails|failed|failing|failure|error|errors|denied|rejected|unauthorized|forbidden|expired|revoked|timed out|timeout)\b/i;

/**
 * An instruction that steers away from calling. Two shapes, both taken from the
 * real memories: a flat prohibition ("never invoke", "do not call"), and the
 * substitution ("ask the user … before calling", "… instead of calling").
 *
 * The `[^.]{0,N}` spans keep each match inside one sentence, so a prohibition in
 * one sentence cannot pair with a verb three sentences later.
 */
const DISCOURAGING_INSTRUCTION: RegExp[] = [
  /\b(never|do not|don'?t|avoid|refrain from)\b[^.]{0,60}?\b(invoke|invoking|call|calling|use|using|run|running|query|querying)\b/i,
  /\bask\b[^.]{0,40}?\buser\b[^.]{0,90}?\bbefore\b[^.]{0,40}?\b(call|calling|invoke|invoking|use|using)/i,
  /\bask\b[^.]{0,40}?\buser\b[^.]{0,90}?\binstead\b/i,
];

/** Does this rule name something the model can actually reach this turn? */
function referencesLive(haystack: string, index: Set<string>): boolean {
  for (const token of index) {
    if (haystack.includes(token)) return true;
  }
  return false;
}

/**
 * True when this rule would talk the model out of a capability it has right now.
 * See the module doc for why a failure-triggered rule is never suppressed.
 */
export function suppressesLiveCapability(rule: ProceduralValue, index: Set<string>): boolean {
  if (index.size === 0) return false;
  const trigger = rule?.trigger ?? '';
  const instruction = rule?.instruction ?? '';
  if (!instruction) return false;
  if (POST_FAILURE_TRIGGER.test(trigger)) return false;
  if (!DISCOURAGING_INSTRUCTION.some((re) => re.test(instruction))) return false;
  return referencesLive(`${trigger} ${instruction}`.toLowerCase(), index);
}

export interface RuleFilterResult {
  kept: ProceduralValue[];
  /** Trigger text of each dropped rule, for the log. Never silent. */
  suppressed: string[];
}

/**
 * Partitions recalled rules into the ones worth injecting and the ones that
 * would argue against a live tool. Order of `kept` is preserved so the recall
 * ranking survives.
 */
export function filterSuppressiveRules(rules: ProceduralValue[], index: Set<string>): RuleFilterResult {
  const kept: ProceduralValue[] = [];
  const suppressed: string[] = [];
  for (const rule of rules) {
    if (suppressesLiveCapability(rule, index)) suppressed.push(rule.trigger);
    else kept.push(rule);
  }
  if (suppressed.length > 0) {
    // A rule silently withheld is the same debugging trap as a silently dropped
    // tool: the model's behaviour changes and nothing anywhere says why.
    logger.info(
      { suppressed, keptCount: kept.length },
      '[memory] withheld learned rules that argue against a tool available this turn',
    );
  }
  return { kept, suppressed };
}

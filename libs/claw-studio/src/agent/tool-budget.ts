import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import { createLogger } from '@chatbot/shared';

const logger = createLogger('claw-studio:agent:tool-budget');

/**
 * Keeps the tool surface inside what the model can actually read.
 *
 * Tool schemas are sent on EVERY model call and are not part of the message
 * history, so summarization can never shrink them. A live Claw registers 102
 * tools whose OpenAI-format schemas serialize to ~76KB — roughly 19k tokens
 * against a self-hosted model whose entire context window is 16k. Measured on a
 * real run, the prompt was 21,258 tokens of which 21,252 were fixed and the
 * conversation itself was 26 characters. Every turn started over budget, and no
 * amount of context compaction could have changed that.
 *
 * Rather than fail, drop the least essential groups until the schemas fit, and
 * say so in the log. A quietly reduced tool surface would be its own debugging
 * trap: the model would simply claim it cannot browse, with no explanation
 * anywhere.
 *
 * Large-window providers are unaffected — at a 193k budget the limit is far above
 * anything the tool list can reach, so nothing is dropped.
 */

/** Share of the input budget the tool schemas may occupy. */
const SCHEMA_BUDGET_FRACTION = 0.45;
const CHARS_PER_TOKEN = 4;

export type ToolGroup = 'core' | 'web' | 'mcp' | 'integration' | 'browser';

/**
 * Drop order, least essential first. `core` is absent because it is never dropped.
 *
 * `mcp` sits BELOW `integration` and `web` — i.e. it survives both. A tenant
 * registered those servers by hand and `connectedCapabilitiesSection` advertises
 * them to the model by name; a built-in integration nobody switched on has not
 * earned the same standing. While `mcp_*` fell through to `integration` it was
 * the first thing dropped after the browser, so on a small-window provider the
 * prompt went on promising `mcp_grafana_*` after the tools behind it were gone —
 * the model then improvised, which is precisely the failure this whole section
 * of the prompt exists to prevent.
 */
const DROP_ORDER: ToolGroup[] = ['browser', 'integration', 'web', 'mcp'];

const CORE_TOOLS = new Set([
  'get_current_time',
  'search_memory',
  'save_memory',
  'write_todos',
  'load_skill',
  // Scheduling is Claw's own capability, not a third-party one, so it belongs
  // with memory and todos rather than in the droppable integration pool — where
  // the fallthrough in toolGroupOf had been putting it, ahead of web search in
  // the drop order. "Remind me every morning" is a core promise of the product;
  // losing it to a budget trim leaves the model to improvise with whatever
  // integration tool survived.
  'create_scheduled_task',
  'list_scheduled_tasks',
  'update_scheduled_task',
  'delete_scheduled_task',
]);

/**
 * Which group a tool belongs to, by name.
 *
 * Name-based because that is all the assembled list carries in common — the
 * tools arrive from eight different factories with no shared metadata. Prefix
 * matching is used for the families that share one (`browser_`, `mcp_`, `web_`,
 * `*_workspace_file`); everything unrecognised is treated as an integration,
 * which is the safe default: unknown tools become droppable rather than
 * silently occupying core's protected space.
 */
export function toolGroupOf(name: string): ToolGroup {
  if (name.startsWith('browser_')) return 'browser';
  // Prefix, not substring: `createMcpTools` namespaces every discovered tool as
  // `mcp_<server-slug>_<tool>`, while a built-in like `some_mcp_thing` merely
  // happens to contain the letters.
  if (name.startsWith('mcp_')) return 'mcp';
  if (CORE_TOOLS.has(name)) return 'core';
  if (name.endsWith('_workspace_file') || name === 'list_workspace_files') return 'core';
  if (name.startsWith('web_')) return 'web';
  return 'integration';
}

interface NamedTool {
  name: string;
}

export interface BudgetOptions {
  inputBudget: number;
  /** Override the default share of the budget schemas may use. */
  schemaFraction?: number;
}

export interface BudgetResult<T> {
  tools: T[];
  dropped: Array<{ name: string; group: ToolGroup }>;
  schemaTokensBefore: number;
  schemaTokensAfter: number;
  limitTokens: number;
  /** True when even the undroppable core exceeds the limit — nothing more can be done here. */
  overBudgetAfterTrim: boolean;
}

/** Serialized size of a tool's wire-format schema, in estimated tokens. */
function schemaTokens(tool: unknown): number {
  try {
    // The OpenAI function format is what actually goes on the wire, so this
    // measures the real cost rather than the zod object's internal shape.
    return Math.round((JSON.stringify(convertToOpenAITool(tool as never))?.length ?? 0) / CHARS_PER_TOKEN);
  } catch {
    // An unconvertible tool still costs something; assume a typical schema
    // rather than zero, so it cannot hide from the budget.
    return 200;
  }
}

export function budgetTools<T extends NamedTool>(tools: T[], options: BudgetOptions): BudgetResult<T> {
  const limitTokens = Math.round(options.inputBudget * (options.schemaFraction ?? SCHEMA_BUDGET_FRACTION));
  const costs = new Map<T, number>(tools.map((t) => [t, schemaTokens(t)]));
  const total = (list: T[]) => list.reduce((n, t) => n + (costs.get(t) ?? 0), 0);

  const schemaTokensBefore = total(tools);
  let kept = [...tools];
  const dropped: Array<{ name: string; group: ToolGroup }> = [];

  for (const group of DROP_ORDER) {
    if (total(kept) <= limitTokens) break;
    const survivors: T[] = [];
    for (const t of kept) {
      if (toolGroupOf(t.name) === group) dropped.push({ name: t.name, group });
      else survivors.push(t);
    }
    kept = survivors;
  }

  const schemaTokensAfter = total(kept);
  const overBudgetAfterTrim = schemaTokensAfter > limitTokens;

  if (dropped.length > 0) {
    logger.warn(
      {
        limitTokens,
        schemaTokensBefore,
        schemaTokensAfter,
        droppedCount: dropped.length,
        droppedGroups: [...new Set(dropped.map((d) => d.group))],
        dropped: dropped.map((d) => d.name),
      },
      'Tool schemas exceeded the model context budget — dropped the least essential tools',
    );
  }

  if (overBudgetAfterTrim) {
    logger.error(
      { limitTokens, schemaTokensAfter, keptCount: kept.length },
      'Core tool schemas alone exceed the model context budget — this model is too small for this tool surface',
    );
  }

  return { tools: kept, dropped, schemaTokensBefore, schemaTokensAfter, limitTokens, overBudgetAfterTrim };
}

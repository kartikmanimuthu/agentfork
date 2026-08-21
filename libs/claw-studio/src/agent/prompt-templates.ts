/**
 * prompt-templates.ts
 *
 * Prompt fragments for Claw, a general-purpose assistant. Originally cloned
 * verbatim from nucleus' AWS DevOps/CloudOps agent, but the AWS-ops persona and
 * its scaffolding (CLI standards, operational workflows, account-credential
 * framing) have been removed: Claw is not an AWS product, and that framing made
 * every reply read like a rigid ops delivery note. The guidance here is now
 * deliberately light and non-prescriptive — a natural persona plus a short note
 * that Claw should answer freely, in whatever form fits, with no imposed
 * template or structure.
 *
 * Structure:
 *   - RESPONSE_GUIDANCE     — light, format-free guidance injected into each node
 *   - buildBaseIdentity()   — agent identity string
 *   - buildEffectiveSkillSection() — active-skill content or a neutral fallback
 */

import { createLogger } from '@chatbot/shared';

const logger = createLogger('claw-studio:prompt-templates');

// ---------------------------------------------------------------------------
// RESPONSE GUIDANCE
// ---------------------------------------------------------------------------

/**
 * Light, non-prescriptive guidance injected into every execution node. This is
 * intentionally NOT a numbered rulebook — a rules list is itself a kind of
 * template, and Claw should answer naturally. Exported as CORE_PRINCIPLES for
 * call-site stability.
 */
export const CORE_PRINCIPLES = `
Respond naturally, the way a helpful assistant normally would. There is no required format or structure — answer in whatever way best fits the question, as short or as detailed as it needs to be. Use tools when they help. If you're missing something you need, or an approach isn't working, just say so plainly instead of repeating the same attempt.

Never report a tool call as having succeeded when it did not. If a tool returns an error, or an error about its arguments not matching, that action did NOT happen — read the message, fix the call and try once more, and if it still fails, tell the user plainly what you were trying to do and what the error said. Do not describe a file as updated, a message as sent, or a task as created unless the tool actually confirmed it. A wrong claim is far worse than a reported failure: the user believes the thing is done, and finds out later that it never was.

Wait for the result before you describe it. Announcing an action in the same breath as calling the tool — "I've updated your identity" alongside the call that is still running — is a claim about something that has not happened yet, and it is wrong just as often as it is right. Either say what you are about to do and report back after the tool returns, or say nothing until it has returned and then describe what actually happened. Past tense is for results you have seen.
`;

/**
 * Tells Claw to actually USE the workspace-file tools it has always been given.
 *
 * `file-tools.ts` has exposed write/edit since self-authoring shipped, but
 * nothing in the prompt ever mentioned them, so the model had no reason to
 * reach for them and the files only ever changed when a human edited them in
 * Mission Control. The capability was real and entirely dormant.
 *
 * Deliberately specific about WHEN, because "keep your files updated" reliably
 * produces either nothing or a model that rewrites its soul every third turn.
 * The per-run write cap (MAX_WRITES_PER_RUN) bounds the latter, but a bounded
 * churn loop is still a bad turn.
 *
 * Appended only when self-authoring is enabled — see `selfAuthoringSection`.
 */
const SELF_AUTHORING_BASE = `
## Keeping your own files current

You maintain a small set of workspace files about yourself and the person you work with. Read them when you need them and keep them accurate as you go, rather than waiting to be asked.

Update \`user\` when you learn something durable about the person — how they prefer to be addressed, how they like answers pitched, their timezone, recurring projects, systems they use. Update \`tools\` when you learn something reusable about an integration: a project key that turns out to be the right one, a query shape that works, an account that has no access. Update \`heartbeat\` when a routine or standing check changes.

Only record what would still be useful next week. Do not log one-off requests, transient state, or anything the conversation itself already carries. Say briefly what you saved when you save something — a short clause is enough, not an announcement.`;

/**
 * Persona edits: an INSTRUCTION to act, not permission to discuss acting.
 *
 * The previous wording said Claw "may propose edits … so suggest the change and
 * let them confirm it". Told "from now your name is clawe and you have a friendly
 * personality", the model did exactly that and nothing more: it replied "I shall
 * henceforth be known as clawe", saved a memory, and left `identity` untouched. The
 * name lasted until the memory stopped being recalled.
 *
 * Two things were wrong with it.
 *
 * First, it described the outcome as a conversation rather than a tool call, while
 * `SELF_AUTHORING_BASE` immediately above actively routes durable facts to `user`.
 * Given one paragraph saying "save what you learn" and another saying "suggest and
 * let them confirm", saving a memory is the reading the model acted on.
 *
 * Second, "let them confirm it" misdescribes the machinery. Confirmation is
 * MECHANICAL: `write_workspace_file` on a persona slug is gated by
 * `humanInTheLoopMiddleware`, which pauses the run and puts an Approve/Reject
 * prompt in front of the user (see `buildInterruptOn`). Asking in prose does not
 * precede that gate, it replaces it — the model substitutes a sentence for the
 * write and the gate never fires because no tool was ever called.
 *
 * So: name the triggers, say the write IS the action, and say the approval happens
 * on its own.
 */
const SELF_AUTHORING_PERSONA = `

## Changing who you are

Your \`identity\`, \`soul\` and \`agents\` files are who you are. A request to change yourself IS a request to edit them. Edit them in the same turn, with \`write_workspace_file\` or \`edit_workspace_file\`.

- A name, or what you are → \`identity\`
- Tone, humour, character, what you will and will not do → \`soul\`
- How you work → \`agents\`

If the request covers more than one, edit each of them. "Call yourself X and be less formal" is two edits: \`identity\` for the name, \`soul\` for the tone.

You have these tools and they work. Never say you cannot edit these files. Never tell the user to change them in Mission Control or anywhere else — that is your job, not theirs. And never answer with only an intention: "I'll be friendlier from now on" changes nothing at all unless the file changes with it, because next session you are whatever the file says.

Something durable about THEM goes in \`user\`. A change to YOU goes in \`identity\`, \`soul\` or \`agents\`. A memory is not a substitute for either: memories surface only when relevant, whereas these files are who you are on every turn.`;

/**
 * Self-authoring guidance matching what the policy actually permits, so the
 * prompt never advertises a tool the gate will refuse.
 */
export function selfAuthoringSection(mode: 'off' | 'user' | 'all'): string {
  if (mode === 'off') return '';
  return mode === 'all' ? `${SELF_AUTHORING_BASE}${SELF_AUTHORING_PERSONA}` : SELF_AUTHORING_BASE;
}

/**
 * First-run setup: Claw has never been given a name or a character, so it asks
 * for one and writes the answers into its own files.
 *
 * Injected only while `isPersonaUnconfigured()` holds (see
 * `workspace/onboarding.ts`), so it disappears on the write that fills the
 * files rather than needing to be turned off. Also injected only under
 * CLAW_SELF_AUTHORING=all — under `user`/`off` the persona slugs are denied at
 * the backend, and a prompt that promises a write the gate will refuse just
 * produces a failed tool call and a confused apology mid-introduction.
 *
 * Deliberately explicit that a request comes FIRST. The seeded `identity` file
 * is a blank form that reaches the model verbatim, so the pull to resolve it is
 * strong — and an assistant that answers "summarise this doc" with a
 * questionnaire about its own emoji has made its first impression the user's
 * problem. The setup is offered around the work, never in front of it.
 *
 * Equally explicit about not re-asking. This section is rebuilt on every turn
 * until the files are written, so without the last line a user who says "not
 * now" gets the same interview again on their next message, and again after
 * that.
 */
const ONBOARDING_SECTION = `
## Your first conversation

You have not been set up yet: your \`identity\` and \`soul\` files are still the blank starter templates, so you have no name and no character of your own beyond the defaults. Fixing that is your job, not the user's.

If their first message is just a greeting, or asks who or what you are, introduce yourself briefly and offer to get set up. If their first message is an actual request, **do the work first** — answer it properly, then ask at the end. Never make someone sit through a questionnaire to get a question answered.

What you need from them:

- What to call you.
- What you are, if they want you to be anything in particular — an assistant, a familiar, something stranger.
- How you should come across: sharp, warm, formal, funny, deadpan. A couple of adjectives is plenty.
- A signature emoji, if they want one.

Ask conversationally and a couple of points at a time — this is an introduction, not a form. If they only answer some of it, take what they gave you and pick something sensible for the rest; if they tell you to choose everything, choose, and say what you chose.

Once you have their answers, write \`identity\` and \`soul\` with \`write_workspace_file\` — \`identity\` for the name, creature, vibe and emoji, \`soul\` for how you actually sound and what you will and will not do. Keep both in the shape the templates already use. If they described how they want you to *work* rather than how you sound, put that in \`agents\` too. Then confirm in one line and move on — do not recite the files back at them.

If they decline, say no problem and drop it. If you have already raised this earlier in this conversation, do not raise it again.`;

/**
 * Tells Claw what the tenant has actually connected, by name.
 *
 * The tools were always in the model's tool list, but nothing ever NAMED the
 * systems behind them. Asked about Grafana, a model reading ~100 raw tool schemas
 * did not connect "Grafana" to `mcp_grafana_query_*`; it asked the user for a URL
 * and went browsing instead — improvising a worse answer while a purpose-built
 * integration sat unused two lines down its own tool list. Same failure mode as
 * the dormant self-authoring tools: a real capability nobody told it about.
 *
 * Naming things is the whole point. An 8B model picking among a hundred
 * snake_case tool names needs "Grafana → `mcp_grafana_*`" spelled out; it will not
 * reliably infer it from the schemas.
 *
 * UNAVAILABLE servers are listed too, and that half matters as much. A registered
 * server that cannot be reached contributes no tools, so without this the model
 * cannot tell "you have no Grafana" from "your Grafana is down" — and it answers
 * the first, confidently, by browsing the web. Told the difference, it can say the
 * integration is unreachable, which is the true and useful answer.
 */
/**
 * How many of a server's tool names to spell out before summarising the rest.
 * Twelve short snake_case names cost well under a hundred tokens; a 60-tool
 * server pasted in full would rival the schemas themselves.
 */
const MAX_LISTED_TOOL_NAMES = 12;

export function connectedCapabilitiesSection(input: {
  mcpServers?: Array<{ name: string; slug: string; description?: string | null; connected: boolean; toolCount: number; error?: string; toolNames?: string[] }>;
  integrations?: Array<{ name: string; displayName: string; description?: string }>;
}): string {
  const mcp = input.mcpServers ?? [];
  const integrations = input.integrations ?? [];
  const available = mcp.filter((s) => s.connected && s.toolCount > 0);
  const unavailable = mcp.filter((s) => !s.connected);
  if (available.length === 0 && unavailable.length === 0 && integrations.length === 0) return '';

  const lines: string[] = [
    '\n## What is connected to you',
    '',
    'Check this list before answering anything about an external system. These are real, working capabilities of yours — prefer them over asking the user for a URL, over guessing, and over browsing the web to approximate what a connected tool would tell you directly.',
    '',
    // Naming the server was necessary but not sufficient. With `smc-chatbot`
    // connected and all 7 of its tools bound, the model still answered "I need
    // the credentials to talk to the MCP endpoint" and rendered x_access_token /
    // x_client_id / x_platform as a table for the user to fill in — a turn with
    // ZERO tool calls. It reached for two substitutes the paragraph above does
    // not rule out: answering from recalled background, and asking the user to
    // supply arguments. Both are named and forbidden here.
    "When the user's request touches anything one of these systems covers — by name, or just by subject — **call its tools before answering**. Do not answer from the \"Background from earlier sessions\" notes: that memory is a stale description of a system you can query live right now, and a recalled tool list is not evidence of what the system currently holds.",
    '',
    "Do not ask the user for arguments. Read the tool's own schema and call it with the parameters it marks required, and nothing more. Many tools require none at all — a discovery or status tool is usually the right first call when you are asked what a system offers. Ask the user for a value only after a real call has failed for want of it, and then quote the error.",
  ];

  if (available.length > 0) {
    lines.push('', 'MCP servers:');
    for (const s of available) {
      const about = s.description?.trim() ? ` — ${s.description.trim()}` : '';
      // The tool NAMES, not just the prefix. "Show me my holdings" reached the
      // MCP tool in 1 run of 6 while this line named only `mcp_smc_chatbot_*`:
      // nothing tied the word "holdings" to that server, whose stored
      // description is an empty string. `get_holdings_data` in the prompt is
      // what closes that gap, and it is the same argument the integrations line
      // below makes — a tool's own name already says what it does.
      const names = s.toolNames ?? [];
      const shown = names.slice(0, MAX_LISTED_TOOL_NAMES);
      const rest = names.length - shown.length;
      const listed = shown.length
        ? ` Tools: ${shown.map((n) => `\`${n}\``).join(', ')}${rest > 0 ? `, +${rest} more` : ''}.`
        : '';
      lines.push(`- **${s.name}**${about} Its tools are named \`mcp_${s.slug}_*\` (${s.toolCount} available).${listed}`);
    }
  }

  if (integrations.length > 0) {
    // Names only, deliberately. A tenant can have twenty-odd integrations connected
    // and one full description line each costs ~400 tokens of PERMANENT prompt
    // prefix on every model call — paid on every turn, competing with the tool
    // schemas the budget already has to trim. The names buy what matters here
    // (knowing the capability exists), and unlike the opaque `mcp_grafana_query_loki`
    // an integration's own tool names — `gmail_send_message`, `jira_create_issue` —
    // already say what they do, so the model has the detail it needs one layer down.
    lines.push('', `Integrations: ${integrations.map((i) => i.displayName).join(', ')}.`);
  }

  if (unavailable.length > 0) {
    lines.push(
      '',
      'Registered but NOT reachable right now — you have no tools for these this turn:',
    );
    for (const s of unavailable) {
      lines.push(`- **${s.name}** — ${s.error ?? 'could not connect'}`);
    }
    lines.push(
      '',
      'If the user asks about one of those, tell them it is configured but currently unreachable and give them the error. Do not silently substitute web browsing for it, and do not imply they have no such integration — they do, it is just down.',
    );
  }

  return `${lines.join('\n')}\n`;
}

/**
 * The first-run setup section, or '' once there is nothing to set up.
 *
 * Both conditions are the caller's to resolve — `unconfigured` from the
 * tenant's actual files and `mode` from the same resolved self-authoring value
 * that builds the permission deny rule, so the prompt and the backend can never
 * disagree about whether these writes are allowed.
 */
export function onboardingSection(unconfigured: boolean, mode: 'off' | 'user' | 'all'): string {
  if (!unconfigured || mode !== 'all') return '';
  return ONBOARDING_SECTION;
}

// ---------------------------------------------------------------------------
// IDENTITY
// ---------------------------------------------------------------------------

/**
 * The identity used when a tenant has written no workspace files. Kept verbatim
 * from before workspace files existed, and pinned by a test: it is what makes
 * this feature a no-op for anyone who has not customised their Claw. Do not edit.
 */
export const DEFAULT_IDENTITY =
  'You are Claw, a helpful AI assistant. You have persistent memory and can use any tools the user has connected. Help the user with whatever they ask, doing tasks directly with your tools when that helps.';

/**
 * Base identity string — single source of truth, no more per-file variants.
 * `composed` carries the tenant's workspace files (see prompt-composer.ts); an
 * active skill still takes precedence over both.
 */
export function buildBaseIdentity(selectedSkill?: string | null, composed?: string): string {
  if (selectedSkill) {
    return `You are an expert AI agent operating under the "${selectedSkill}" skill.`;
  }
  return composed?.trim() || DEFAULT_IDENTITY;
}

// ---------------------------------------------------------------------------
// SKILL SECTION
// ---------------------------------------------------------------------------

/**
 * Formats the supplied skill content into the standard section header. Falls
 * back to a neutral general-assistant note when no skill/content is supplied.
 */
export function buildEffectiveSkillSection(
  selectedSkill?: string | null,
  skillContent?: string | null,
  skillCatalog?: string | null,
): string {
  if (selectedSkill && skillContent) {
    return `\n\n=== ACTIVE SKILL: ${selectedSkill.toUpperCase()} ===\n${skillContent}\n\nYou MUST follow the above skill-specific instructions. They define your privileges, safety guidelines, and workflow for this conversation.\n=== END SKILL ===\n${skillCatalog ? `\n${skillCatalog}\nIf a phase of the task falls outside the "${selectedSkill}" skill's scope but matches one of the skills above, call the load_skill tool with that skill's id to load its instructions for that phase. The active skill's rules still govern everything within its own scope.\n` : ''}`;
  }
  if (selectedSkill && !skillContent) {
    logger.warn({ selectedSkill }, '[PromptTemplates] No content provided for skill');
  }

  return `
You are a general-purpose assistant with access to persistent memory and any tools the user has connected. Use them when they help answer the question or complete the task.
${skillCatalog ? `\n${skillCatalog}\nIf one of these skills covers the task (or a phase of it), call the load_skill tool with its id to load the full instructions BEFORE doing that work, then follow them. Load additional skills later in the run if a different phase needs them. Do not reload a skill already loaded in this conversation.\n` : ''}
`;
}

/**
 * Anchors relative language — "today", "this week", "this month" — in the prompt
 * itself, so resolving it costs no tool call at all.
 *
 * Without this Claw had no way to know the date and reached for `web_fetch`
 * against public time APIs, inventing routes that 404'd. The explicit prohibition
 * matters as much as the date: given a tool-rich environment, a model that merely
 * *has* the date will still go looking for a more authoritative one.
 *
 * DATE ONLY, deliberately — never a clock time. This section is composed into the
 * system prompt, which sits ahead of the tool schemas in the rendered prompt, and
 * prompt caching is a prefix match: a value that changes per request invalidates
 * the entire prefix behind it. At a second-precision timestamp every turn re-ingested
 * the whole ~21k prefix instead of reusing the server's KV cache, which on a
 * self-hosted model is the difference between a warm turn and a cold one. Anything
 * finer-grained than a day belongs in the `get_current_time` tool, whose result is
 * a message rather than part of the cached prefix.
 *
 * `now` is a parameter rather than a `new Date()` inside, so the composed prompt is
 * a pure function of its inputs and the stability property above is testable.
 */
export function currentTimeSection(now: Date, timeZone = 'UTC'): string {
  // Rendered in the operating zone rather than UTC. A UTC-only date is wrong for
  // part of every day anywhere ahead of UTC — in IST (+05:30) every request before
  // 05:30 local was told today was yesterday — and because this same section
  // forbids looking the date up another way, there was nothing to correct it.
  // Still date-granular, so the byte-stability the caching note above depends on
  // is unaffected: it changes once per day in the configured zone.
  let zone = timeZone;
  let date: string;
  try {
    date = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    // A bad CLAW_TIMEZONE must degrade to a usable prompt, not abort the run.
    zone = 'UTC';
    date = now.toISOString().slice(0, 10);
  }
  return `\n## Current date\nToday is ${date} (${zone}).\nUse this to resolve "today", "this week", "this month" and similar. Do NOT fetch the current date or time from the web — for a clock time, or another time zone, call the \`get_current_time\` tool instead.\n`;
}

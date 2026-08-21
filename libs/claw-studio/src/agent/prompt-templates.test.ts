import { describe, it, expect } from 'vitest';
import {
  CORE_PRINCIPLES, DEFAULT_IDENTITY, buildBaseIdentity, buildEffectiveSkillSection,
  currentTimeSection, onboardingSection, connectedCapabilitiesSection, selfAuthoringSection,
} from './prompt-templates';

describe('prompt-templates (general-assistant persona)', () => {
  it('CORE_PRINCIPLES grants free-form answering and imposes no template', () => {
    expect(CORE_PRINCIPLES).toMatch(/no required format or structure/i);
    // It must NOT reintroduce a numbered rulebook or AWS framing.
    expect(CORE_PRINCIPLES).not.toMatch(/AWS CLI/);
    expect(CORE_PRINCIPLES).not.toMatch(/^\s*1\.\s/m);
  });

  it('buildBaseIdentity returns a general assistant persona with no skill', () => {
    const identity = buildBaseIdentity();
    expect(identity).toMatch(/helpful AI assistant/i);
    expect(identity).not.toMatch(/DevOps|Cloud Operations/);
  });

  it('buildBaseIdentity returns a skill-scoped persona when a skill is active', () => {
    expect(buildBaseIdentity('incident-response')).toContain('"incident-response" skill');
  });

  it('buildEffectiveSkillSection falls back to a neutral general note with no skill', () => {
    const section = buildEffectiveSkillSection();
    expect(section).toMatch(/general-purpose assistant/i);
    expect(section).not.toMatch(/Base DevOps Engineer/);
  });

  it('buildEffectiveSkillSection renders the active-skill section when content is supplied', () => {
    const section = buildEffectiveSkillSection('incident-response', 'Do the runbook.');
    expect(section).toContain('ACTIVE SKILL: INCIDENT-RESPONSE');
    expect(section).toContain('Do the runbook.');
  });

  it('buildEffectiveSkillSection surfaces the skill catalog + load_skill guidance when a catalog is supplied', () => {
    const section = buildEffectiveSkillSection(null, null, '- billing: Billing questions');
    expect(section).toContain('load_skill');
    expect(section).toContain('billing: Billing questions');
  });
});

describe('buildBaseIdentity with a composed workspace', () => {
  it('falls back to the default identity when nothing is composed', () => {
    expect(buildBaseIdentity()).toBe(DEFAULT_IDENTITY);
    expect(buildBaseIdentity(null, '')).toBe(DEFAULT_IDENTITY);
    expect(buildBaseIdentity(null, '   ')).toBe(DEFAULT_IDENTITY);
  });

  // Pins the non-regression guarantee (spec §7.4): a tenant with no workspace
  // files must get byte-identical prompts to before this feature existed.
  it('preserves the pre-change default string verbatim', () => {
    expect(DEFAULT_IDENTITY).toBe(
      'You are Claw, a helpful AI assistant. You have persistent memory and can use any tools the user has connected. Help the user with whatever they ask, doing tasks directly with your tools when that helps.',
    );
  });

  it('returns the composed workspace when one is supplied', () => {
    expect(buildBaseIdentity(null, '=== WHO YOU ARE ===\nAda')).toContain('Ada');
  });

  it('lets an active skill still override the composed workspace', () => {
    expect(buildBaseIdentity('deploy', '=== WHO YOU ARE ===\nAda')).toBe(
      'You are an expert AI agent operating under the "deploy" skill.',
    );
  });
});

describe('currentTimeSection', () => {
  // Anchors relative language ("this week", "today") without a tool call at all.
  // Without it Claw could only learn the date by fetching a website, which is how
  // a simple question turned into three failed web_fetch calls.
  it('states the current date', () => {
    const section = currentTimeSection(new Date('2026-08-18T09:30:00Z'));
    expect(section).toContain('2026-08-18');
  });

  // A UTC-only date is wrong for a chunk of every day in any zone ahead of UTC,
  // and the same section forbids resolving it another way. In IST (+05:30) every
  // request between 00:00 and 05:29 local time was told today was YESTERDAY, so
  // "what's on today" silently resolved to the wrong day with nothing to hint at it.
  it('renders the date in the configured zone, not UTC', () => {
    // 19:00 UTC on the 18th is already 00:30 on the 19th in Kolkata.
    const at = new Date('2026-08-18T19:00:00Z');
    expect(currentTimeSection(at, 'Asia/Kolkata')).toContain('2026-08-19');
    expect(currentTimeSection(at)).toContain('2026-08-18');
  });

  it('names the zone it used, so a wrong setting is visible rather than silent', () => {
    expect(currentTimeSection(new Date('2026-08-18T09:30:00Z'), 'Asia/Kolkata')).toContain('Asia/Kolkata');
  });

  it('falls back to UTC when the configured zone is invalid instead of throwing', () => {
    const section = currentTimeSection(new Date('2026-08-18T09:30:00Z'), 'Mars/Olympus_Mons');
    expect(section).toContain('2026-08-18');
  });

  it('stays byte-stable within a day in the configured zone', () => {
    const a = currentTimeSection(new Date('2026-08-18T19:00:00Z'), 'Asia/Kolkata');
    const b = currentTimeSection(new Date('2026-08-18T19:45:00Z'), 'Asia/Kolkata');
    expect(b).toBe(a);
  });

  // The load-bearing property, and the reason this is date-granular rather than
  // second-granular: this section sits ahead of the system prompt and tool schemas
  // in the prompt, and prompt caching is a prefix match. A timestamp that changes
  // per request invalidates the whole ~21k prefix every turn, so a self-hosted
  // model reprocesses all of it instead of reusing its KV cache. Time-of-day
  // precision is what the get_current_time tool is for.
  it('is byte-identical across requests within the same day, so the prompt prefix stays cacheable', () => {
    const morning = currentTimeSection(new Date('2026-08-18T09:30:00Z'));
    const seconds_later = currentTimeSection(new Date('2026-08-18T09:30:07Z'));
    const evening = currentTimeSection(new Date('2026-08-18T21:14:59Z'));
    expect(seconds_later).toBe(morning);
    expect(evening).toBe(morning);
  });

  it('does change when the date rolls over, so "today" never goes stale', () => {
    const today = currentTimeSection(new Date('2026-08-18T23:59:59Z'));
    const tomorrow = currentTimeSection(new Date('2026-08-19T00:00:01Z'));
    expect(tomorrow).not.toBe(today);
    expect(tomorrow).toContain('2026-08-19');
  });

  it('tells Claw not to look the time up on the web', () => {
    const section = currentTimeSection(new Date('2026-08-18T09:30:00Z'));
    expect(section).toMatch(/do not|never/i);
    expect(section).toMatch(/web|fetch|internet/i);
  });

  it('names the tool to use for other time zones', () => {
    expect(currentTimeSection(new Date('2026-08-18T09:30:00Z'))).toContain('get_current_time');
  });
});

describe('onboardingSection', () => {
  it('is empty once the persona is configured', () => {
    expect(onboardingSection(false, 'all')).toBe('');
  });

  // Withheld under the modes whose deny rule blocks identity/soul/agents, so
  // the prompt can never advertise a write the backend will refuse.
  it('is empty under the self-authoring modes that deny the persona slugs', () => {
    expect(onboardingSection(true, 'user')).toBe('');
    expect(onboardingSection(true, 'off')).toBe('');
  });

  it('asks for the things that make up a persona when unconfigured under mode "all"', () => {
    const section = onboardingSection(true, 'all');
    expect(section).toContain('What to call you.');
    expect(section).toContain('signature emoji');
    expect(section).toMatch(/sharp, warm, formal/);
  });

  it('names the tool and the files the answers must be written to', () => {
    const section = onboardingSection(true, 'all');
    expect(section).toContain('write_workspace_file');
    expect(section).toContain('`identity`');
    expect(section).toContain('`soul`');
  });

  // The two behavioural rules the section exists to enforce: work before
  // questionnaire, and never ask twice in one conversation.
  it('puts the user’s request ahead of the setup', () => {
    expect(onboardingSection(true, 'all')).toContain('**do the work first**');
  });

  it('tells Claw not to raise it again in the same conversation', () => {
    expect(onboardingSection(true, 'all')).toContain('do not raise it again');
  });
});

describe('connectedCapabilitiesSection', () => {
  const grafana = {
    name: 'Grafana', slug: 'grafana', description: 'Dashboards and metrics', connected: true, toolCount: 7,
    toolNames: ['mcp_grafana_query_loki', 'mcp_grafana_list_dashboards'],
  };

  it('is empty when nothing is connected, so the prompt gains nothing', () => {
    expect(connectedCapabilitiesSection({})).toBe('');
    expect(connectedCapabilitiesSection({ mcpServers: [], integrations: [] })).toBe('');
  });

  // The reported bug: asked about Grafana, the model asked for a URL and browsed
  // instead of using the Grafana MCP it already had. It needs the NAME mapped to
  // the tool prefix.
  it('names the server and the tool prefix its tools carry', () => {
    const section = connectedCapabilitiesSection({ mcpServers: [grafana] });
    expect(section).toContain('**Grafana**');
    expect(section).toContain('`mcp_grafana_*`');
    expect(section).toContain('Dashboards and metrics');
  });

  it('tells the model to check this before reaching for the web', () => {
    const section = connectedCapabilitiesSection({ mcpServers: [grafana] });
    expect(section).toContain('Check this list before answering');
    expect(section).toMatch(/browsing the web/);
  });

  // The reported bug this section did NOT cover: with `smc-chatbot` connected and
  // its 7 tools bound, the model answered "I need the credentials to talk to the
  // MCP endpoint" and listed x_access_token / x_client_id / x_platform as a table
  // for the user to fill in — never calling anything. Naming the server was not
  // enough; the section has to forbid the two specific substitutes the model
  // reached for instead of a tool call.
  it('forbids answering from background memory about a connected system', () => {
    const section = connectedCapabilitiesSection({ mcpServers: [grafana] });
    expect(section).toMatch(/call .*tool.*before answering|call its tools/i);
    expect(section).toMatch(/background from earlier sessions|memory/i);
  });

  // "Show me my holdings" reached the MCP tool in 1 of 6 runs while the section
  // named only the server and its prefix: nothing connected the word "holdings"
  // to `smc-chatbot`, whose stored description is an empty string. The tool
  // names ARE the description — `get_holdings_data` says what it does — and 7
  // of them cost a fraction of one description line.
  it('lists each server\'s tool names, so a request can be matched by vocabulary', () => {
    const section = connectedCapabilitiesSection({ mcpServers: [grafana] });
    expect(section).toContain('mcp_grafana_query_loki');
    expect(section).toContain('mcp_grafana_list_dashboards');
  });

  it('caps a long tool list rather than pasting a whole server into the prefix', () => {
    const many = Array.from({ length: 30 }, (_, i) => `mcp_grafana_tool_${i}`);
    const section = connectedCapabilitiesSection({ mcpServers: [{ ...grafana, toolCount: 30, toolNames: many }] });
    expect(section).toContain('mcp_grafana_tool_0');
    expect(section).not.toContain('mcp_grafana_tool_29');
    expect(section).toMatch(/\+\d+ more/);
  });

  it('falls back to the prefix alone when no tool names are supplied', () => {
    const section = connectedCapabilitiesSection({ mcpServers: [{ ...grafana, toolNames: undefined }] });
    expect(section).toContain('`mcp_grafana_*`');
  });

  it('forbids asking the user for arguments a tool does not require', () => {
    const section = connectedCapabilitiesSection({ mcpServers: [grafana] });
    expect(section).toMatch(/do not ask the user/i);
    expect(section).toMatch(/required/i);
  });

  // A connected server that discovered no tools is not a capability, so listing it
  // would invite the model to call tools that do not exist.
  it('omits a connected server that exposes no tools', () => {
    expect(connectedCapabilitiesSection({ mcpServers: [{ ...grafana, toolCount: 0 }] })).toBe('');
  });

  // Names only: a tenant with 21 integrations connected would otherwise add ~400
  // tokens of permanent prompt prefix, and their tool names already self-describe.
  it('lists connected integrations by name, compactly', () => {
    const section = connectedCapabilitiesSection({
      integrations: [
        { name: 'gmail', displayName: 'Gmail', description: 'Send and read mail' },
        { name: 'jira', displayName: 'Jira', description: 'Issues' },
      ],
    });
    expect(section).toContain('Integrations: Gmail, Jira.');
    expect(section).not.toContain('Send and read mail');
  });

  // The other half of the bug: an unreachable server contributes no tools, so
  // without this the model cannot distinguish "you have no Grafana" from
  // "your Grafana is down" — and confidently answers the first.
  it('reports a registered server that could not be reached, with its error', () => {
    const section = connectedCapabilitiesSection({
      mcpServers: [{ ...grafana, connected: false, toolCount: 0, error: 'Unable to connect. Is the computer able to access the url?' }],
    });
    expect(section).toContain('NOT reachable');
    expect(section).toContain('**Grafana**');
    expect(section).toContain('Unable to connect');
  });

  it('tells the model to report an unreachable server rather than substitute browsing', () => {
    const section = connectedCapabilitiesSection({
      mcpServers: [{ ...grafana, connected: false, toolCount: 0, error: 'timeout' }],
    });
    expect(section).toContain('configured but currently unreachable');
    expect(section).toMatch(/do not imply they have no such integration/i);
  });

  it('separates reachable from unreachable when both are present', () => {
    const section = connectedCapabilitiesSection({
      mcpServers: [grafana, { name: 'Jira', slug: 'jira', connected: false, toolCount: 0, error: 'refused' }],
    });
    expect(section).toContain('`mcp_grafana_*`');
    expect(section).toContain('NOT reachable');
    // Jira must not be advertised as usable.
    expect(section).not.toContain('`mcp_jira_*`');
  });

  it('handles a server with no description without printing an empty dash', () => {
    const section = connectedCapabilitiesSection({
      mcpServers: [{ name: 'Grafana', slug: 'grafana', description: null, connected: true, toolCount: 3 }],
    });
    expect(section).toContain('**Grafana**');
    expect(section).not.toContain('— \n');
    expect(section).not.toContain('**Grafana** —');
  });
});

describe('selfAuthoringSection — persona edits must be an instruction to act', () => {
  // The reported failure, twice over. First the model replied "I shall henceforth be
  // known as clawe" and saved a memory; then, told to update its identity, it said
  // "I can't alter my own identity files directly — that's something you'd do in
  // Mission Control" while nothing was blocked (deniedWritePaths was empty and all
  // 102 tools were present). The prompt is the only thing that could have produced
  // that refusal, so it is what these pin.
  it('tells Claw to edit the file, in the same turn', () => {
    const section = selfAuthoringSection('all');
    expect(section).toMatch(/A request to change yourself IS a request to edit them/);
    expect(section).toMatch(/Edit them in the same turn/);
    expect(section).toContain('write_workspace_file');
  });

  it('maps each kind of request to the file that owns it', () => {
    const section = selfAuthoringSection('all');
    expect(section).toMatch(/A name, or what you are → `identity`/);
    expect(section).toMatch(/Tone, humour, character[\s\S]*`soul`/);
    expect(section).toMatch(/How you work → `agents`/);
  });

  // It updated `soul` but left `identity` alone on a request that covered both.
  it('says to edit every file the request touches, with a worked example', () => {
    const section = selfAuthoringSection('all');
    expect(section).toMatch(/If the request covers more than one, edit each of them/);
    expect(section).toMatch(/two edits/);
  });

  // The exact excuse, forbidden by name.
  it('forbids claiming it cannot edit them, or deferring to Mission Control', () => {
    const section = selfAuthoringSection('all');
    expect(section).toMatch(/Never say you cannot edit these files/);
    expect(section).toMatch(/Never tell the user to change them in Mission Control/);
  });

  // Deliberately absent now. Mentioning an approval step invited exactly the
  // deferral above from a small model — it read "pauses for the person's approval"
  // as "someone else does this". Persona writes are pre-granted under `all`, so
  // there is no gate to describe either.
  it('does not mention approval or permission at all', () => {
    const section = selfAuthoringSection('all');
    expect(section).not.toMatch(/approval/i);
    expect(section).not.toMatch(/permission/i);
  });

  it('answering with only an intention is called out as changing nothing', () => {
    expect(selfAuthoringSection('all')).toMatch(/changes nothing at all unless the file changes with it/);
  });

  it('distinguishes a fact about the user from a change to itself', () => {
    const section = selfAuthoringSection('all');
    expect(section).toMatch(/durable about THEM goes in `user`/);
    expect(section).toMatch(/A change to YOU goes in `identity`, `soul` or `agents`/);
  });

  it('withholds the persona guidance under user mode, which cannot write those slugs', () => {
    const section = selfAuthoringSection('user');
    expect(section).not.toContain('Changing who you are');
    expect(section).not.toContain('write_workspace_file');
    expect(section).toContain('Keeping your own files current');
  });

  it('is empty under off mode', () => {
    expect(selfAuthoringSection('off')).toBe('');
  });
});

describe('CORE_PRINCIPLES — honesty about tool failures', () => {
  // The reported behaviour: edit_workspace_file failed on a schema mismatch and the
  // agent still answered as though the file had been changed.
  it('forbids reporting a failed tool call as a success', () => {
    expect(CORE_PRINCIPLES).toMatch(/Never report a tool call as having succeeded when it did not/);
  });

  it('names an argument-schema error as a failure, since that was the case that slipped through', () => {
    expect(CORE_PRINCIPLES).toMatch(/arguments not matching/);
  });

  it('tells it to retry once and then say what the error was', () => {
    expect(CORE_PRINCIPLES).toMatch(/fix the call and try once more/);
    expect(CORE_PRINCIPLES).toMatch(/what the error said/);
  });

  it('specifically forbids claiming a file was updated without confirmation', () => {
    expect(CORE_PRINCIPLES).toMatch(/Do not describe a file as updated[\s\S]*unless the tool actually confirmed it/);
  });
});

describe('CORE_PRINCIPLES — no claiming a result before the tool returns', () => {
  // What the user saw: the model said "I've updated your identity" while the write
  // was still running, so the answer read as finished while the tool spun.
  it('tells it to wait for the result before describing it', () => {
    expect(CORE_PRINCIPLES).toMatch(/Wait for the result before you describe it/);
  });

  it('calls out the specific failure of narrating in the same breath as the call', () => {
    expect(CORE_PRINCIPLES).toMatch(/in the same breath as calling the tool/);
  });

  it('reserves past tense for results actually observed', () => {
    expect(CORE_PRINCIPLES).toMatch(/Past tense is for results you have seen/);
  });
});

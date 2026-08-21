import { describe, it, expect, vi } from 'vitest';

// `deepagents` is a package import, not a relative one — vi.mock reliably
// intercepts it (the repo's known vi.mock limitation is relative-module
// imports only, per libs/claw-studio/CLAUDE.md). Wrapping the real
// `createDeepAgent` in a spy, rather than replacing it, lets Finding 1's test
// assert on what was actually passed in while every other test in this file
// still gets a real, working agent out of it.
vi.mock('deepagents', async () => {
  const actual = await vi.importActual<typeof import('deepagents')>('deepagents');
  return { ...actual, createDeepAgent: vi.fn(actual.createDeepAgent) };
});

import { createDeepAgent } from 'deepagents';
import { createClawDeepAgent, buildInterruptOn } from './claw-deep-agent';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { tool } from '@langchain/core/tools';
import { HumanMessage } from '@langchain/core/messages';
import type { AgentMiddleware } from 'langchain';
import { z } from 'zod';
import { WORKSPACE_TEMPLATES } from '../workspace/templates';
import type { WorkspaceSlug } from '../workspace/types';

const mockedCreateDeepAgent = vi.mocked(createDeepAgent);

const readTool = tool(async () => 'ok', {
  name: 'get_weather',
  description: 'read only',
  schema: z.object({}),
});
const writeTool = tool(async () => 'ok', {
  name: 'jira_create_issue',
  description: 'mutative',
  schema: z.object({}),
});

// Minimal ToolCallRequest stand-in — `when` predicates only read `.toolCall.name`.
function callFor(name: string) {
  return { toolCall: { name } } as never;
}

describe('buildInterruptOn', () => {
  it('gates a mutative tool and lets a read-only tool through', () => {
    const map = buildInterruptOn([readTool, writeTool], { granted: new Set(), policyMode: 'ask' });
    expect(map['get_weather']).toBe(false);

    const gated = map['jira_create_issue'];
    expect(gated).toMatchObject({ allowedDecisions: ['approve', 'edit', 'reject'] });
    // Fix round 2, Important 8: an ungranted mutative tool must re-check
    // `granted` live via `when`, not freeze a verdict at construction time.
    expect(typeof (gated as { when?: unknown }).when).toBe('function');
    expect((gated as { when: (r: unknown) => boolean }).when(callFor('jira_create_issue'))).toBe(true);
  });

  it('exempts a granted tool — and stays exempt if granted only AFTER construction (live check, not a snapshot)', () => {
    const granted = new Set<string>();
    const map = buildInterruptOn([writeTool], { granted, policyMode: 'ask' });
    const gated = map['jira_create_issue'] as { when: (r: unknown) => boolean };

    // Not yet granted at construction time — `when` says "interrupt".
    expect(gated.when(callFor('jira_create_issue'))).toBe(true);

    // Granted mid-run, AFTER buildInterruptOn ran (exactly file-tools.ts's
    // lazy-population contract) — the SAME `when` closure must now say
    // "don't interrupt", because it reads `granted` live, not a snapshot.
    granted.add('jira_create_issue');
    expect(gated.when(callFor('jira_create_issue'))).toBe(false);
  });

  it("auto-approves everything under policyMode 'all'", () => {
    const map = buildInterruptOn([writeTool], { granted: new Set(), policyMode: 'all' });
    expect(map['jira_create_issue']).toBe(false);
  });

  // `granted` used to be keyed on TOOL NAME alone, but write_workspace_file
  // takes the slug as an argument — so one free write to `user` put the bare
  // name in the set and every later call to that same tool skipped the gate,
  // whatever slug it targeted. In CLAW_SELF_AUTHORING=user the backend deny
  // rule masked it; in 'all' that deny list is empty, so Claw could rewrite its
  // own soul unprompted off the back of a routine `user` write.
  it('scopes a workspace grant to the slug it was granted for', () => {
    const granted = new Set<string>(['write_workspace_file:user']);
    const workspaceWrite = tool(async () => 'ok', {
      name: 'write_workspace_file',
      description: 'mutative',
      schema: z.object({ slug: z.string() }),
    });
    const map = buildInterruptOn([workspaceWrite], { granted, policyMode: 'ask' });
    const gated = map['write_workspace_file'] as { when: (r: unknown) => boolean };

    const callWithSlug = (slug: string) =>
      ({ toolCall: { name: 'write_workspace_file', args: { slug } } }) as never;

    expect(gated.when(callWithSlug('user'))).toBe(false); // granted slug — no prompt
    expect(gated.when(callWithSlug('soul'))).toBe(true); // different slug — still prompts
    expect(gated.when(callWithSlug('identity'))).toBe(true);
  });

  it('still honours a bare-name grant for tools that take no slug', () => {
    const granted = new Set<string>(['jira_create_issue']);
    const map = buildInterruptOn([writeTool], { granted, policyMode: 'ask' });
    const gated = map['jira_create_issue'] as { when: (r: unknown) => boolean };
    expect(gated.when(callFor('jira_create_issue'))).toBe(false);
  });
});

describe('createClawDeepAgent', () => {
  it('builds an agent exposing stream and invoke', () => {
    const agent = createClawDeepAgent({
      model: new FakeListChatModel({ responses: ['done'] }),
      tools: [readTool],
      tenantId: 't1',
      userId: 'claw_1',
    });
    expect(typeof agent.stream).toBe('function');
    expect(typeof agent.invoke).toBe('function');
  });

  it('composes to DEFAULT_IDENTITY when there are no workspace files', () => {
    // Non-regression guarantee pinned by prompt-composer.test.ts.
    const agent = createClawDeepAgent({
      model: new FakeListChatModel({ responses: ['done'] }),
      tools: [],
      workspaceFiles: new Map(),
      tenantId: 't1',
      userId: 'claw_1',
    });
    expect(agent).toBeDefined();
  });

  // Fix round 1, Finding 1 — `modelCallLimit` was accepted but never enforced.
  it('wires modelCallLimitMiddleware into the middleware array passed to createDeepAgent', () => {
    createClawDeepAgent({
      model: new FakeListChatModel({ responses: ['done'] }),
      tools: [],
      modelCallLimit: 7,
      tenantId: 't1',
      userId: 'claw_1',
    });

    const lastCallArgs = mockedCreateDeepAgent.mock.calls.at(-1)?.[0] as
      | { middleware?: AgentMiddleware[] }
      | undefined;
    const names = (lastCallArgs?.middleware ?? []).map((m) => m.name);
    // Present regardless of caller-supplied middleware, per finding 1's fix:
    // pushed ahead of `...middleware` so `middleware` is never empty.
    expect(names).toContain('ModelCallLimitMiddleware');
  });

  // Fix round 1, Finding 2 — the stateSchema claim needed a runtime check, not
  // just a `.d.ts` reading. This exercises the exact failure mode Task 3
  // warned about: a middleware writing `taskDescription`/`memoryContext` via a
  // `beforeModel` hook, with NO stateSchema of its own — only
  // `createClawDeepAgent`'s top-level `stateSchema` declares those keys. If
  // deepagents' runtime merge does not honor `InferAgentState`'s documented
  // behavior, these values come back `undefined` and this test fails — which
  // is exactly the load-bearing defect this test exists to catch before
  // Task 5 wires the real memory middleware in.
  it('carries memoryContext/taskDescription written by a middleware through to the final state', async () => {
    const probeMiddleware: AgentMiddleware = {
      name: 'probeMemoryWrite',
      async beforeModel() {
        return { taskDescription: 'probe-task', memoryContext: 'probe-context' };
      },
    };

    const agent = createClawDeepAgent({
      model: new FakeListChatModel({ responses: ['done'] }),
      tools: [],
      middleware: [probeMiddleware],
      tenantId: 't1',
      userId: 'claw_1',
    });

    const result = await agent.invoke({ messages: [new HumanMessage('hi')] });

    expect(result.taskDescription).toBe('probe-task');
    expect(result.memoryContext).toBe('probe-context');
  });

  // Fix round 2, Critical 1 — recall used to only write `state.memoryContext`;
  // nothing spliced it into the model's actual prompt, so an expensive recall
  // bought nothing and the success log still printed. This runs a REAL turn
  // through `createClawMemoryMiddleware` and inspects what the model actually
  // received, the same way claw-graph.test.ts's `recordingModel` does.
  //
  // NOTE: monkey-patching `model.invoke` (as claw-graph.test.ts's
  // `recordingModel` does) does NOT work here — deepagents' forced
  // FilesystemMiddleware means `tools.length > 0` is ALWAYS true, so the
  // model node ALWAYS calls `model.bindTools(tools)` before invoking, and
  // `FakeListChatModel.bindTools()`
  // (@langchain/core/dist/utils/testing/chat_models.cjs:244-278) constructs
  // and returns a BRAND NEW `FakeListChatModel` instance rather than
  // returning `this` — silently bypassing any override made on the original
  // instance. `RecordingFakeModel` below overrides `bindTools()` to return
  // `this`, so the override survives.
  it('splices recalled memoryContext into the system message the model actually receives', async () => {
    class RecordingFakeModel extends FakeListChatModel {
      systemMessagesSeen: string[] = [];
      override bindTools() {
        return this;
      }
      override async _generate(messages: unknown[], options: never, runManager: never) {
        const system = messages.find((m) => (m as { _getType?: () => string })?._getType?.() === 'system');
        if (system) {
          // The composed system prompt arrives as `SystemMessage({ contentBlocks })`
          // here, not a plain string — `.content` is an array of `{ type: 'text',
          // text }` blocks. `String(content)` on an array of objects yields
          // "[object Object],[object Object]", silently hiding the real text.
          const raw = (system as { content: unknown }).content;
          const text = Array.isArray(raw)
            ? raw.map((block) => (block as { text?: string })?.text ?? '').join('')
            : String(raw);
          this.systemMessagesSeen.push(text);
        }
        return super._generate(messages as never, options, runManager);
      }
    }

    const model = new RecordingFakeModel({ responses: ['done'] });
    const systemMessagesSeen = model.systemMessagesSeen;

    const { createClawMemoryMiddleware } = await import('../memory/memory-middleware');
    const memoryMiddleware = createClawMemoryMiddleware({
      recallNode: async () => ({ memoryContext: 'THE_USER_PREFERS_METRIC_UNITS', memoryStats: null }),
      saveNode: async () => ({ memoryStats: null }),
    });

    const agent = createClawDeepAgent({
      model,
      tools: [],
      middleware: [memoryMiddleware],
      tenantId: 't1',
      userId: 'claw_1',
    });

    await agent.invoke({ messages: [new HumanMessage('hi')] });

    expect(systemMessagesSeen.some((s) => s.includes('THE_USER_PREFERS_METRIC_UNITS'))).toBe(true);
    // The verbatim caveat from claw-graph.ts:213 — proves the SAME wrapper
    // text is reused, not a reworded stand-in.
    expect(
      systemMessagesSeen.some((s) =>
        s.includes('trust only the tools actually available to you in this message, never a memory note about it'),
      ),
    ).toBe(true);
  });

  // Fix round 2, Important 4 — todoListMiddleware() is only auto-added by
  // deepagents for the Codex harness profile; Anthropic/Bedrock models (what
  // Claw actually runs) get no write_todos tool unless we add it ourselves.
  it('registers write_todos even for a non-Codex model, via todoListMiddleware', () => {
    const agent = createClawDeepAgent({
      model: new FakeListChatModel({ responses: ['done'] }),
      tools: [],
      tenantId: 't1',
      userId: 'claw_1',
    }) as unknown as { options?: { middleware?: AgentMiddleware[] } };

    const allTools = (agent.options?.middleware ?? []).flatMap((m) => m.tools ?? []);
    expect(allTools.some((t) => t.name === 'write_todos')).toBe(true);
  });

  // Fix round 2, Important 5 — a tenant-configured tool literally named
  // "execute" (a plausible MCP tool name) collides with a deepagents built-in
  // and previously made createDeepAgent throw ConfigurationError at
  // construction, hard-failing every turn for that tenant.
  it('drops a tenant tool whose name collides with a deepagents built-in instead of throwing', () => {
    const collidingTool = tool(async () => 'ok', {
      name: 'execute',
      description: 'an MCP tool that happens to be named like a deepagents built-in',
      schema: z.object({}),
    });

    expect(() =>
      createClawDeepAgent({
        model: new FakeListChatModel({ responses: ['done'] }),
        tools: [collidingTool],
        tenantId: 't1',
        userId: 'claw_1',
      }),
    ).not.toThrow();

    const lastCallArgs = mockedCreateDeepAgent.mock.calls.at(-1)?.[0] as { tools?: Array<{ name: string }> } | undefined;
    // Our custom "execute" must be gone from what reached createDeepAgent —
    // otherwise the real (unmocked underneath) implementation would throw.
    expect((lastCallArgs?.tools ?? []).some((t) => t.name === 'execute' && t.description?.includes('MCP'))).toBe(false);
  });

  // Fix round 2, Critical 2 — the forced write_file/edit_file/task tools were
  // completely absent from `interruptOn` (buildInterruptOn only ever saw
  // `deps.tools`), so humanInTheLoopMiddleware auto-approved them regardless
  // of policy, and nothing stopped a write to a GATED slug (identity/soul/
  // agents) once Task 5 wires in ClawWorkspaceBackend.
  it('gates the forced write_file/edit_file tools and denies writes to gated workspace slugs via permissions', () => {
    createClawDeepAgent({
      model: new FakeListChatModel({ responses: ['done'] }),
      tools: [],
      // Explicit, not the ambient default — this repo's root `.env` (Bun loads
      // it automatically) sets `CLAW_SELF_AUTHORING=all` for local dev, which
      // would silently make this assertion vacuous if left to fall through to
      // `selfAuthoringMode()`.
      selfAuthoringMode: 'user',
      tenantId: 't1',
      userId: 'claw_1',
    });

    const lastCallArgs = mockedCreateDeepAgent.mock.calls.at(-1)?.[0] as
      | {
          interruptOn?: Record<string, unknown>;
          permissions?: Array<{ operations: string[]; paths: string[]; mode?: string }>;
        }
      | undefined;

    // write_file/edit_file are no longer silently absent from interruptOn.
    expect(lastCallArgs?.interruptOn?.['write_file']).toBeTruthy();
    expect(lastCallArgs?.interruptOn?.['edit_file']).toBeTruthy();
    expect(lastCallArgs?.interruptOn).toHaveProperty('task');

    // self-authoring mode 'user' denies writes to the GATED slugs.
    const denyRule = (lastCallArgs?.permissions ?? []).find((p) => p.mode === 'deny');
    expect(denyRule?.operations).toEqual(['write']);
    expect(denyRule?.paths).toEqual(expect.arrayContaining(['/identity.md', '/soul.md', '/agents.md']));
    expect(denyRule?.paths).not.toEqual(expect.arrayContaining(['/user.md']));
  });

  it("denies writes to ALL workspace slugs when selfAuthoringMode is 'off'", () => {
    createClawDeepAgent({
      model: new FakeListChatModel({ responses: ['done'] }),
      tools: [],
      selfAuthoringMode: 'off',
      tenantId: 't1',
      userId: 'claw_1',
    });

    const lastCallArgs = mockedCreateDeepAgent.mock.calls.at(-1)?.[0] as
      | { permissions?: Array<{ paths: string[] }> }
      | undefined;
    expect(lastCallArgs?.permissions?.[0]?.paths).toHaveLength(6);
  });

  it("denies nothing when selfAuthoringMode is 'all'", () => {
    createClawDeepAgent({
      model: new FakeListChatModel({ responses: ['done'] }),
      tools: [],
      selfAuthoringMode: 'all',
      tenantId: 't1',
      userId: 'claw_1',
    });

    const lastCallArgs = mockedCreateDeepAgent.mock.calls.at(-1)?.[0] as
      | { permissions?: Array<unknown> }
      | undefined;
    expect(lastCallArgs?.permissions ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// First-run setup (workspace/onboarding.ts + prompt-templates' onboardingSection)
// ---------------------------------------------------------------------------

describe('createClawDeepAgent — first-run persona setup', () => {
  /** The system prompt `createDeepAgent` was actually handed on the last build. */
  function lastSystemPrompt(): string {
    const args = mockedCreateDeepAgent.mock.calls.at(-1)?.[0] as { systemPrompt?: string } | undefined;
    return args?.systemPrompt ?? '';
  }

  function seededFiles(): Map<WorkspaceSlug, string> {
    return new Map(Object.entries(WORKSPACE_TEMPLATES) as Array<[WorkspaceSlug, string]>);
  }

  function build(files: Map<WorkspaceSlug, string>, mode: 'off' | 'user' | 'all') {
    createClawDeepAgent({
      model: new FakeListChatModel({ responses: ['done'] }),
      tools: [],
      workspaceFiles: files,
      selfAuthoringMode: mode,
      tenantId: 't1',
      userId: 'claw_1',
    });
  }

  it('asks the user to name and characterise it while the persona files are still templates', () => {
    build(seededFiles(), 'all');
    const prompt = lastSystemPrompt();
    expect(prompt).toContain('## Your first conversation');
    expect(prompt).toContain('What to call you.');
    // Names the tool it must actually call — a setup section that never says
    // how to persist the answers produces an interview and no files.
    expect(prompt).toContain('write_workspace_file');
  });

  // Per the agreed behaviour: a first message that carries real work gets
  // answered first. Pinned because it is the whole difference between a warm
  // introduction and a questionnaire standing between the user and their answer.
  it('tells Claw to answer a real request before running the setup', () => {
    build(seededFiles(), 'all');
    expect(lastSystemPrompt()).toContain('**do the work first**');
  });

  it('stops asking once soul has been written', () => {
    const files = seededFiles();
    files.set('soul', '# SOUL.md\n\nYou are terse and a little sardonic.\n');
    build(files, 'all');
    expect(lastSystemPrompt()).not.toContain('## Your first conversation');
  });

  it('stops asking once identity has been written', () => {
    const files = seededFiles();
    files.set('identity', '# IDENTITY.md\n\n- **Name:** Pixel\n');
    build(files, 'all');
    expect(lastSystemPrompt()).not.toContain('## Your first conversation');
  });

  // The prompt must never advertise a write the backend will refuse: under
  // 'user'/'off', buildWorkspacePermissions denies identity/soul/agents, so an
  // introduction that promised to save the answers would just fail mid-setup.
  it("stays out of the prompt under CLAW_SELF_AUTHORING=user, whose deny rule blocks these writes", () => {
    build(seededFiles(), 'user');
    const prompt = lastSystemPrompt();
    expect(prompt).not.toContain('## Your first conversation');

    const args = mockedCreateDeepAgent.mock.calls.at(-1)?.[0] as
      | { permissions?: Array<{ paths: string[] }> }
      | undefined;
    // Same build: the slugs the section would have asked Claw to write are the
    // ones denied here. Asserted together so the two can never drift apart.
    expect(args?.permissions?.[0]?.paths).toHaveLength(3);
  });

  it("stays out of the prompt under CLAW_SELF_AUTHORING=off", () => {
    build(seededFiles(), 'off');
    expect(lastSystemPrompt()).not.toContain('## Your first conversation');
  });

  // A tenant with no rows at all is the pre-seed state, not a configured agent.
  it('asks when the tenant has no workspace files at all', () => {
    build(new Map(), 'all');
    expect(lastSystemPrompt()).toContain('## Your first conversation');
  });
});

describe('createClawDeepAgent — connected capabilities reach the prompt', () => {
  function lastSystemPrompt(): string {
    const args = mockedCreateDeepAgent.mock.calls.at(-1)?.[0] as { systemPrompt?: string } | undefined;
    return args?.systemPrompt ?? '';
  }

  // The whole point of the fix: the tools were always in the tool list, but nothing
  // NAMED Grafana, so the model asked for a URL and browsed instead.
  it('names a connected MCP server and its tool prefix', () => {
    createClawDeepAgent({
      model: new FakeListChatModel({ responses: ['done'] }),
      tools: [],
      mcpServers: [{ name: 'Grafana', slug: 'grafana', description: 'Metrics', connected: true, toolCount: 7 }],
      tenantId: 't1',
      userId: 'claw_1',
    });
    expect(lastSystemPrompt()).toContain('`mcp_grafana_*`');
  });

  it('names an unreachable server so the model can say it is down', () => {
    createClawDeepAgent({
      model: new FakeListChatModel({ responses: ['done'] }),
      tools: [],
      mcpServers: [{ name: 'Grafana', slug: 'grafana', connected: false, toolCount: 0, error: 'connection refused' }],
      tenantId: 't1',
      userId: 'claw_1',
    });
    const prompt = lastSystemPrompt();
    expect(prompt).toContain('NOT reachable');
    expect(prompt).toContain('connection refused');
  });

  // Non-regression: a tenant with nothing connected must get the same prompt it
  // always did, with no empty section header.
  it('adds nothing for a tenant with no MCP servers or integrations', () => {
    createClawDeepAgent({
      model: new FakeListChatModel({ responses: ['done'] }),
      tools: [],
      tenantId: 't1',
      userId: 'claw_1',
    });
    expect(lastSystemPrompt()).not.toContain('What is connected to you');
  });
});

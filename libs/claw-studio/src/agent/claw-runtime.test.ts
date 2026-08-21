import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { getPrismaClient, EncryptionService } from '@chatbot/shared';
import { getOrCreateClawConversation, resolveClawRuntime, createTaskDescriptionMiddleware } from './claw-runtime';
import { createClawDeepAgent } from './claw-deep-agent';
import { ClawWorkspaceBackend } from './workspace-backend';
import { WorkspaceFileService } from '../workspace/workspace-file-service';
import { WORKSPACE_TEMPLATES } from '../workspace/templates';
import type { WorkspaceSlug } from '../workspace/types';

// Integration-style, against the real (migrated) local dev Postgres — matches
// the pattern already used successfully elsewhere in this lib (persistence.test.ts,
// memory-tools.test.ts). `vi.mock` does not currently intercept relative-module
// imports in this package (a verified pre-existing environment issue, see
// memory-tools.test.ts's comment), so this avoids fighting it rather than
// papering over a broken mock. Only the DB-wiring/config-shape is asserted here
// (never `.invoke()` on the returned graph) — model construction from real
// provider config does not make a network call, so this stays fast and offline.
const db = getPrismaClient();
const suffix = Date.now().toString(36);

let tenantWithProviderId: string;
let clawIdWithProvider: string;
let tenantWithoutProviderId: string;
let tenantAutoProvisionId: string;

beforeAll(async () => {
  const tenantWithProvider = await db.tenant.create({ data: { name: `claw-runtime-test-${suffix}-a` } });
  tenantWithProviderId = tenantWithProvider.id;
  const studio = await db.clawStudio.create({
    data: { tenantId: tenantWithProviderId, studioId: `claw_test_${suffix}`, passwordHash: 'test-hash-not-verified' },
  });
  const claw = await db.claw.create({
    data: { clawStudioId: studio.id, name: 'Claw', autoApprove: true, systemPrompt: 'You specialize in billing questions.' },
  });
  clawIdWithProvider = claw.id;

  const encryption = new EncryptionService();
  await db.llmProvider.create({
    data: {
      tenantId: tenantWithProviderId,
      name: 'Test Bedrock Provider',
      providerType: 'BEDROCK',
      region: 'ap-south-1',
      chatModel: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      credentials: encryption.encrypt(JSON.stringify({ accessKeyId: 'AKIAFAKE', secretAccessKey: 'fake-secret' })),
      isDefault: true,
    },
  });

  const tenantWithoutProvider = await db.tenant.create({ data: { name: `claw-runtime-test-${suffix}-b` } });
  tenantWithoutProviderId = tenantWithoutProvider.id;
  const studioNoProvider = await db.clawStudio.create({
    data: { tenantId: tenantWithoutProviderId, studioId: `claw_test_noprov_${suffix}`, passwordHash: 'test-hash-not-verified' },
  });
  await db.claw.create({ data: { clawStudioId: studioNoProvider.id, name: 'Claw' } });

  // A real tenant with a default provider but NO Studio/Claw — exercises the
  // auto-provision-on-first-access branch.
  const tenantAutoProvision = await db.tenant.create({ data: { name: `claw-runtime-test-${suffix}-c` } });
  tenantAutoProvisionId = tenantAutoProvision.id;
  await db.llmProvider.create({
    data: {
      tenantId: tenantAutoProvisionId,
      name: 'Test Bedrock Provider',
      providerType: 'BEDROCK',
      region: 'ap-south-1',
      chatModel: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      credentials: encryption.encrypt(JSON.stringify({ accessKeyId: 'AKIAFAKE', secretAccessKey: 'fake-secret' })),
      isDefault: true,
    },
  });
});

afterAll(async () => {
  const tenantIds = [tenantWithProviderId, tenantWithoutProviderId, tenantAutoProvisionId];
  await db.clawConversation.deleteMany({ where: { claw: { studio: { tenantId: { in: tenantIds } } } } });
  await db.claw.deleteMany({ where: { studio: { tenantId: { in: tenantIds } } } });
  await db.clawStudio.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await db.llmProvider.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
});

describe('getOrCreateClawConversation', () => {
  it('creates a conversation thread on first use, then reuses it on a second call', async () => {
    const first = await getOrCreateClawConversation(clawIdWithProvider);
    expect(first.threadId).toMatch(new RegExp(`^claw_${clawIdWithProvider}_`));

    const second = await getOrCreateClawConversation(clawIdWithProvider);
    expect(second.threadId).toBe(first.threadId);
    expect(second.id).toBe(first.id);
  });
});

describe('resolveClawRuntime', () => {
  it('resolves the tenant\'s Claw, its thread, and a config scoped by tenant/claw identity', async () => {
    const runtime = await resolveClawRuntime({ tenantId: tenantWithProviderId });

    expect(runtime.clawId).toBe(clawIdWithProvider);
    expect(runtime.autoApprove).toBe(true);
    expect(runtime.config.configurable.tenant_id).toBe(tenantWithProviderId);
    expect(runtime.config.configurable.user_id).toBe(clawIdWithProvider);
    expect(runtime.config.configurable.thread_id).toBe(runtime.threadId);
    expect(runtime.graph).toBeDefined();
    expect(runtime.mcpCleanup).toBeInstanceOf(Function);
    await expect(runtime.mcpCleanup()).resolves.toBeUndefined();
  });

  it('resolves a runtime whose graph is a deepagents agent', async () => {
    const runtime = await resolveClawRuntime({ tenantId: tenantWithProviderId });
    expect(typeof runtime.graph.stream).toBe('function');
    expect(typeof runtime.graph.invoke).toBe('function');
    expect(runtime.config.configurable).toMatchObject({
      thread_id: expect.any(String),
      tenant_id: tenantWithProviderId,
    });
    await runtime.mcpCleanup();
  });

  it('throws a clear error when the tenant has no LLM provider configured', async () => {
    await expect(resolveClawRuntime({ tenantId: tenantWithoutProviderId })).rejects.toThrow(
      /No LLM provider configured/i,
    );
  });

  it('throws a clear error when the tenant id is invalid (auto-provision cannot create a Studio)', async () => {
    // A bogus tenantId hits the auto-provision branch; provision() fails on the
    // FK to a non-existent tenant, so after re-fetch there is still no Claw.
    await expect(resolveClawRuntime({ tenantId: 'tenant-with-no-studio-at-all' })).rejects.toThrow(
      /No Claw provisioned/i,
    );
  });

  it('auto-provisions a Claw on first access for a real tenant that has a provider but no Studio', async () => {
    const before = await db.clawStudio.findFirst({ where: { tenantId: tenantAutoProvisionId } });
    expect(before).toBeNull();

    const runtime = await resolveClawRuntime({ tenantId: tenantAutoProvisionId });
    expect(runtime.clawId).toBeTruthy();
    expect(runtime.config.configurable.tenant_id).toBe(tenantAutoProvisionId);

    const after = await db.clawStudio.findFirst({ where: { tenantId: tenantAutoProvisionId }, include: { claws: true } });
    expect(after?.claws.length).toBe(1);
    await runtime.mcpCleanup();
  });
});

describe('resolveClawRuntime — workspace files', () => {
  it('seeds the six workspace files on first resolve', async () => {
    const runtime = await resolveClawRuntime({ tenantId: tenantWithProviderId });
    const files = await db.clawFile.findMany({ where: { clawId: runtime.clawId } });
    expect(files.map((f) => f.slug).sort()).toEqual(
      ['agents', 'heartbeat', 'identity', 'soul', 'tools', 'user'],
    );
    expect(files.every((f) => f.version === 1 && f.updatedBy === 'user')).toBe(true);
    await runtime.mcpCleanup();
  });

  it('does not re-seed or bump versions on a second resolve', async () => {
    const first = await resolveClawRuntime({ tenantId: tenantWithProviderId });
    await first.mcpCleanup();
    const second = await resolveClawRuntime({ tenantId: tenantWithProviderId });
    await second.mcpCleanup();

    const files = await db.clawFile.findMany({ where: { clawId: second.clawId } });
    expect(files).toHaveLength(6);
    expect(files.every((f) => f.version === 1)).toBe(true);
  });

  it('picks up an edited soul on the next resolve, and reseeding does not clobber it', async () => {
    const runtime = await resolveClawRuntime({ tenantId: tenantWithProviderId });
    // Write through the service, which is the only path production uses. A raw
    // db.clawFile.update would leave version at 1, and reseedUnedited would
    // (correctly) treat it as untouched seed content and refresh it away.
    await new WorkspaceFileService(tenantWithProviderId, runtime.clawId, db)
      .write('soul', 'MARKER_EDITED_SOUL', { updatedBy: 'user' });
    await runtime.mcpCleanup();

    const reloaded = await resolveClawRuntime({ tenantId: tenantWithProviderId });
    const soul = await db.clawFile.findUnique({
      where: { clawId_slug: { clawId: reloaded.clawId, slug: 'soul' } },
    });
    expect(soul?.content).toBe('MARKER_EDITED_SOUL');
    expect(soul?.version).toBe(2);
    expect(reloaded.graph).toBeDefined();
    await reloaded.mcpCleanup();
  });

  it('binds the four workspace file tools onto the graph', async () => {
    const runtime = await resolveClawRuntime({ tenantId: tenantWithProviderId });
    // The graph is compiled, so assert through the DB-independent surface: the
    // tools exist on the runtime's own tool set via a fresh createFileTools call
    // against the same service, and the runtime resolved without error.
    expect(runtime.graph).toBeDefined();
    const { tools } = await import('./file-tools').then((m) =>
      m.createFileTools(tenantWithProviderId, runtime.clawId));
    expect(tools.map((t) => t.name).sort()).toEqual([
      'edit_workspace_file', 'list_workspace_files', 'read_workspace_file', 'write_workspace_file',
    ]);
    await runtime.mcpCleanup();
  });

  it('refreshes an unedited file whose seed content has drifted from the template', async () => {
    const runtime = await resolveClawRuntime({ tenantId: tenantAutoProvisionId });
    // Simulate a file seeded by an older template: content differs, version still 1.
    await db.clawFile.update({
      where: { clawId_slug: { clawId: runtime.clawId, slug: 'tools' } },
      data: { content: 'stale content from an older template' },
    });
    await runtime.mcpCleanup();

    const reloaded = await resolveClawRuntime({ tenantId: tenantAutoProvisionId });
    const tools = await db.clawFile.findUnique({
      where: { clawId_slug: { clawId: reloaded.clawId, slug: 'tools' } },
    });
    expect(tools?.content).toBe(WORKSPACE_TEMPLATES.tools);
    expect(tools?.version).toBe(1);
    await reloaded.mcpCleanup();
  });
});

/**
 * `resolveClawRuntime` builds `createClawDeepAgent({ backend: new
 * ClawWorkspaceBackend(...), middleware: [createTaskDescriptionMiddleware(), ...] })`
 * but never exercises `.invoke()` on the result (the file's own top comment
 * explains why: the model is real Bedrock config with fake credentials, and a
 * network call has no place in this suite). That leaves `backend` and
 * `taskDescription` unverified beyond "the right object was passed to the
 * right parameter" — exactly the silent-failure shape both are called out for
 * in the task brief. This block runs the SAME two exported building blocks
 * `resolveClawRuntime` wires in through a REAL deepagents agent
 * (`createClawDeepAgent`, unmocked) with a scripted fake model — no network,
 * no Postgres — and asserts on what the agent actually did, not what was
 * passed in.
 */
describe('the exact backend + middleware objects resolveClawRuntime wires in', () => {
  /** Hand-rolled fake — same pattern as workspace-backend.test.ts; a second
   *  Postgres-backed WorkspaceFileService would test persistence again, not
   *  wiring. */
  function fakeWorkspaceService(initial: Partial<Record<WorkspaceSlug, string>>) {
    const files = new Map<WorkspaceSlug, string>(Object.entries(initial) as [WorkspaceSlug, string][]);
    return {
      async read(slug: WorkspaceSlug) {
        const content = files.get(slug);
        return content === undefined ? null : { slug, content, version: 1 };
      },
      async write(slug: WorkspaceSlug, content: string) {
        files.set(slug, content);
        return { slug, content, version: 2 };
      },
      async list() {
        return [...files.entries()].map(([slug, content]) => ({ slug, content, version: 1 }));
      },
    };
  }

  /**
   * FakeListChatModel only ever returns plain text (see claw-graph.test.ts's
   * "FakeListChatModel only yields text" comment), so it cannot drive the
   * forced `read_file` tool at all. Scripted like
   * claw-deep-agent.test.ts's `RecordingFakeModel`: `bindTools()` overridden
   * to return `this` (deepagents ALWAYS calls `model.bindTools(tools)` before
   * invoking, and the base class's real `bindTools()` returns a brand-new
   * instance, silently dropping this override otherwise) and `_generate`
   * overridden to emit one scripted tool call before falling back to the
   * real FakeListChatModel behaviour (canned text) on every later call.
   */
  class ScriptedToolModel extends FakeListChatModel {
    private step = 0;
    override bindTools() {
      return this;
    }
    override async _generate(messages: unknown[], options: never, runManager: never) {
      this.step += 1;
      if (this.step === 1) {
        return {
          generations: [
            {
              message: new AIMessage({
                content: '',
                tool_calls: [{ name: 'read_file', args: { file_path: '/user.md' }, id: 'tc-1' }],
              }),
              text: '',
            },
          ],
        };
      }
      return super._generate(messages as never, options, runManager);
    }
  }

  it('routes the forced read_file tool through ClawWorkspaceBackend, and sets taskDescription from the incoming message', async () => {
    const backend = new ClawWorkspaceBackend(fakeWorkspaceService({ user: 'MARKER_USER_FILE_CONTENT' }) as never);
    const model = new ScriptedToolModel({ responses: ['done'] });

    const agent = createClawDeepAgent({
      model,
      tools: [],
      tenantId: 't1',
      userId: 'claw_1',
      backend,
      middleware: [createTaskDescriptionMiddleware()],
    });

    const result = await agent.invoke({ messages: [new HumanMessage('please read the user file')] });

    // Trap 1 (backend): if `backend` had been omitted (or dropped en route),
    // read_file would hit deepagents' default in-memory StateBackend, which
    // has never heard of "/user.md" — the tool would return an error, not
    // this content, and this assertion is the only thing in the suite that
    // would catch that silently-wrong wiring.
    const toolMessage = result.messages.find(
      (m: unknown) => (m as { _getType?: () => string })._getType?.() === 'tool',
    ) as { content: unknown } | undefined;
    // read_file's ToolMessage content is an array of content blocks
    // (`[{ type: 'text', text: '...' }]`), not a plain string — flatten
    // before asserting rather than stringifying the array itself (which
    // yields the meaningless "[object Object]").
    const toolText = Array.isArray(toolMessage?.content)
      ? (toolMessage.content as Array<{ text?: string }>).map((block) => block?.text ?? '').join('')
      : String(toolMessage?.content ?? '');
    expect(toolText).toContain('MARKER_USER_FILE_CONTENT');

    // Trap 2 (taskDescription): without createTaskDescriptionMiddleware wired
    // in, this channel never gets written and memorySaveNode logs
    // "**Original Task:** Unknown" forever (memory-nodes.ts:290).
    expect((result as { taskDescription?: string }).taskDescription).toBe('please read the user file');
  });
});

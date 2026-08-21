/**
 * bench-env.ts — provisions and resets the benchmark's own tenant.
 *
 * DESTRUCTIVE CODE, POINTED AT A SHARED REMOTE DATABASE. Everything here is
 * guarded by `assertBenchTenant`, which re-reads the tenant from the DB and
 * refuses to proceed unless its name is exactly BENCH_TENANT_NAME. A bug that
 * passes the wrong id therefore fails closed instead of truncating a real
 * tenant's memories.
 *
 * The bench gets its own tenant / studio / claw, and *copies* the credentials
 * from an existing LlmProvider rather than reusing the row, so the comparison
 * runs on the same model and credentials the user actually uses while never
 * touching their Claw's memory, workspace files or revision history
 * (spec §3, "Tenant" row).
 */

import { getPrismaClient } from '@chatbot/shared';
import { WorkspaceFileService } from '@chatbot/claw-studio/workspace/workspace-file-service';

/** Marker name. Nothing destructive runs against a tenant that is not called exactly this. */
export const BENCH_TENANT_NAME = '__agent-bench__';
const BENCH_STUDIO_ID = 'agent-bench-studio';
const BENCH_CLAW_NAME = 'Bench Claw';
/** Never used to log in — Mission Control auth is irrelevant here, but the column is NOT NULL. */
const UNUSABLE_PASSWORD_HASH = 'bench-no-login';

export interface BenchEnv {
  tenantId: string;
  clawStudioId: string;
  clawId: string;
  providerId: string;
  /** Chat model id copied from the borrowed provider — recorded in the manifest. */
  model: string;
}

/**
 * Fails closed. Every delete/truncate path calls this first, so passing a wrong
 * id throws rather than damaging real data.
 */
export async function assertBenchTenant(tenantId: string): Promise<void> {
  const db = getPrismaClient();
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
  if (!tenant) {
    throw new Error(`Refusing to operate: tenant ${tenantId} does not exist.`);
  }
  if (tenant.name !== BENCH_TENANT_NAME) {
    throw new Error(
      `REFUSING TO OPERATE ON A NON-BENCH TENANT. ${tenantId} is named "${tenant.name}", expected "${BENCH_TENANT_NAME}".`,
    );
  }
}

/**
 * Tenants whose providers must never be borrowed. `claw-runtime-test-*` rows are
 * fixtures left behind by claw-runtime.test.ts integration runs. They carry a
 * model/region pairing that does not exist — `us.anthropic.claude-sonnet-4` in
 * ap-south-1 — and fail every call with "The provided model identifier is
 * invalid". They are also the most recently updated rows in the table, so any
 * "newest default provider" heuristic picks them in preference to a real one,
 * which is exactly the bug this list exists to prevent.
 */
const EXCLUDED_TENANT_PATTERNS = [/^claw-runtime-test-/i, /^e2e test/i, /^test /i];

function isBorrowable(tenantName: string): boolean {
  if (tenantName === BENCH_TENANT_NAME) return false;
  return !EXCLUDED_TENANT_PATTERNS.some((re) => re.test(tenantName));
}

/**
 * Picks the provider to copy. Deterministic on purpose: a benchmark whose model
 * silently changes between sessions produces results that cannot be compared
 * across sessions.
 *
 * Order of preference: an explicit id, then the default provider of a borrowable
 * tenant that actually owns a Claw (a real deployment rather than a fixture),
 * tie-broken by tenant name so repeated runs resolve to the same row. Never
 * `updatedAt` — that is what selected the broken fixture.
 */
async function findSourceProvider(sourceProviderId?: string) {
  const db = getPrismaClient();
  if (sourceProviderId) {
    const explicit = await db.llmProvider.findUnique({ where: { id: sourceProviderId } });
    if (!explicit) throw new Error(`Source LlmProvider ${sourceProviderId} not found.`);
    return explicit;
  }

  const tenants = await db.tenant.findMany({ select: { id: true, name: true } });
  const borrowable = new Map(tenants.filter((t) => isBorrowable(t.name)).map((t) => [t.id, t.name]));
  if (borrowable.size === 0) throw new Error('No borrowable tenants found.');

  const studios = await db.clawStudio.findMany({ select: { tenantId: true } });
  const tenantsWithAClaw = new Set(studios.map((s) => s.tenantId));

  const candidates = (
    await db.llmProvider.findMany({ where: { tenantId: { in: [...borrowable.keys()] } } })
  ).sort((a, b) => {
    const claw = Number(tenantsWithAClaw.has(b.tenantId)) - Number(tenantsWithAClaw.has(a.tenantId));
    if (claw !== 0) return claw;
    const dflt = Number(b.isDefault) - Number(a.isDefault);
    if (dflt !== 0) return dflt;
    return (borrowable.get(a.tenantId) ?? '').localeCompare(borrowable.get(b.tenantId) ?? '');
  });

  const chosen = candidates.find((p) => p.chatModel);
  if (!chosen) {
    throw new Error('No borrowable LlmProvider with a chatModel found. Pass an explicit id to provisionBenchEnv().');
  }
  return chosen;
}

/** Idempotent: safe to call before every session. */
export async function provisionBenchEnv(sourceProviderId?: string): Promise<BenchEnv> {
  const db = getPrismaClient();

  const source = await findSourceProvider(sourceProviderId);
  if (!source.chatModel) {
    throw new Error(`Borrowed provider ${source.id} has no chatModel set; the bench needs a pinned model.`);
  }

  const tenant =
    (await db.tenant.findFirst({ where: { name: BENCH_TENANT_NAME } })) ??
    (await db.tenant.create({ data: { name: BENCH_TENANT_NAME, slug: 'agent-bench' } }));

  // Credentials are copied verbatim — they are already AES-256-GCM encrypted at
  // rest and are decrypted with the same ENCRYPTION_KEY, so no plaintext is
  // handled here.
  const provider = await db.llmProvider.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'bench-borrowed' } },
    create: {
      tenantId: tenant.id,
      name: 'bench-borrowed',
      providerType: source.providerType,
      region: source.region,
      credentials: source.credentials,
      chatModel: source.chatModel,
      embeddingModel: source.embeddingModel,
      embeddingDimensions: source.embeddingDimensions,
      isDefault: true,
    },
    update: {
      providerType: source.providerType,
      region: source.region,
      credentials: source.credentials,
      chatModel: source.chatModel,
      embeddingModel: source.embeddingModel,
      embeddingDimensions: source.embeddingDimensions,
    },
  });

  const studio =
    (await db.clawStudio.findUnique({ where: { studioId: BENCH_STUDIO_ID } })) ??
    (await db.clawStudio.create({
      data: { tenantId: tenant.id, studioId: BENCH_STUDIO_ID, passwordHash: UNUSABLE_PASSWORD_HASH },
    }));

  const claw =
    (await db.claw.findFirst({ where: { clawStudioId: studio.id } })) ??
    (await db.claw.create({
      data: {
        clawStudioId: studio.id,
        name: BENCH_CLAW_NAME,
        providerModelId: provider.id,
        // Pinned here as well as via overrides, so a harness bug that drops the
        // override still cannot park an unattended run on an approval gate.
        autoApprove: true,
      },
    }));

  if (claw.providerModelId !== provider.id) {
    await db.claw.update({ where: { id: claw.id }, data: { providerModelId: provider.id, autoApprove: true } });
  }

  return {
    tenantId: tenant.id,
    clawStudioId: studio.id,
    clawId: claw.id,
    providerId: provider.id,
    model: source.chatModel,
  };
}

/**
 * Returns the bench claw to a known state between runs (spec §3): no long-term
 * memory, and workspace files freshly seeded from templates.
 *
 * Both are load-bearing. Without the memory wipe, question *k* conditions the
 * agent that answers *k+1*, and run order differs between arms. Without the
 * reseed, a self-authored `user`/`tools`/`heartbeat` file carries across runs.
 */
export async function resetBenchState(env: BenchEnv): Promise<void> {
  await assertBenchTenant(env.tenantId);
  const db = getPrismaClient();

  await db.clawMemory.deleteMany({ where: { tenantId: env.tenantId } });
  await db.clawWorkingMemory.deleteMany({ where: { tenantId: env.tenantId } }).catch(() => undefined);
  // Revisions cascade from ClawFile; deleting the files clears both.
  await db.clawFile.deleteMany({ where: { clawId: env.clawId } });
  await db.clawConversation.deleteMany({ where: { clawId: env.clawId } });
  await db.clawScheduledTask.deleteMany({ where: { clawId: env.clawId } }).catch(() => undefined);

  const workspace = new WorkspaceFileService(env.tenantId, env.clawId, db);
  await workspace.seed();
}

/** Removes the bench tenant entirely. Everything else cascades from it. */
export async function teardownBenchEnv(env: BenchEnv): Promise<void> {
  await assertBenchTenant(env.tenantId);
  const db = getPrismaClient();
  await db.tenant.delete({ where: { id: env.tenantId } });
}

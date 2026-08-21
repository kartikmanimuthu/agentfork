/**
 * persistence.ts
 *
 * Unified singleton for LangGraph persistence (PostgreSQL only).
 *
 *   - PostgresSaver       → checkpoint state per thread (@langchain/langgraph-checkpoint-postgres)
 *   - PostgresMemoryStore → long-term semantic memory (pgvector + tenant-resolved embeddings)
 *
 * Ported from nucleus lib/agent/persistence.ts. `PostgresChatHistory` (over a
 * `chatMessage` Prisma model) is OMITTED — this repo has no such model, and the
 * Claw uses the checkpointer for thread state, not a separate chat-history table.
 *
 * Uses globalThis to survive dev-server hot reloads, matching the source.
 */

import type { Embeddings } from '@langchain/core/embeddings';
import { Prisma } from '@prisma/client';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { getPrismaClient, createLogger } from '@chatbot/shared';
import { getClawEmbeddings } from '../memory/embeddings';
import { getMemoryService } from '../memory/memory-service';
import { env } from '../env';

const logger = createLogger('claw-studio:persistence');

// ─── Types ───────────────────────────────────────────────────────────────────

interface MemoryStoreInterface {
    batch(ops: unknown[], config?: unknown): Promise<unknown[]>;
}

interface PersistenceInstances {
    checkpointer: PostgresSaver;
    store: PostgresMemoryStore;
}

const g = globalThis as unknown as {
    _persistence: PersistenceInstances | undefined;
    _persistencePromise: Promise<PersistenceInstances> | undefined;
};

// ─── PostgreSQL Memory Store ──────────────────────────────────────────────────

class PostgresMemoryStore implements MemoryStoreInterface {
    // Embeddings are resolved PER TENANT from the configured default provider —
    // there is no shared/default embedder. Cached per tenant to avoid
    // re-decrypting credentials on every memory op. If a tenant has no
    // embedding-capable provider, embedding is skipped and we fall back to
    // recency-ordered text search (semantic search degrades gracefully).
    private embeddingsCache = new Map<string, Promise<Embeddings>>();

    private getEmbeddings(tenantId: string): Promise<Embeddings> {
        let cached = this.embeddingsCache.get(tenantId);
        if (!cached) {
            cached = getClawEmbeddings(tenantId);
            // Don't cache a rejected promise — a later provider config should retry.
            cached.catch(() => this.embeddingsCache.delete(tenantId));
            this.embeddingsCache.set(tenantId, cached);
        }
        return cached;
    }

    async batch(ops: unknown[], _config?: unknown): Promise<unknown[]> {
        const prisma = getPrismaClient();
        const results: unknown[] = [];
        const configurable = (_config as Record<string, unknown>)?.configurable as Record<string, unknown> | undefined;

        for (const op of ops as Array<Record<string, unknown>>) {
            if (op.namespace && op.key && op.value !== undefined) {
                // Put operation — always writes a SEMANTIC memory. This generic
                // LangGraph store channel has no kind concept of its own; PROCEDURAL/
                // EPISODIC memories are written by the memory-nodes.ts cognitive
                // layers directly via MemoryService, not through this store.
                const namespace = Array.isArray(op.namespace) ? (op.namespace as string[]).join('/') : String(op.namespace);
                const key = String(op.key);
                const value = op.value as Record<string, unknown>;
                const tenantId = configurable?.tenant_id as string ?? 'default';
                const userId = configurable?.user_id as string ?? 'default';
                const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

                let embeddingVector: number[] | null = null;
                try {
                    const text = JSON.stringify(value);
                    const emb = await this.getEmbeddings(tenantId);
                    embeddingVector = await emb.embedQuery(text);
                } catch {
                    // no provider / embedding failure is non-fatal — store without vector
                }

                const embeddingStr = embeddingVector ? `[${embeddingVector.join(',')}]` : null;

                if (embeddingStr) {
                    await prisma.$executeRaw`
                        INSERT INTO claw_memories ("id","tenantId","userId","namespace","key","value","kind","embedding","createdAt","updatedAt","expiresAt")
                        VALUES (gen_random_uuid()::text, ${tenantId}, ${userId}, ${namespace}, ${key}, ${JSON.stringify(value)}::jsonb, 'SEMANTIC'::"MemoryKind", ${embeddingStr}::vector, NOW(), NOW(), ${expiresAt})
                        ON CONFLICT ("tenantId","namespace","key") WHERE "supersededById" IS NULL DO UPDATE
                        SET "value" = EXCLUDED."value", "embedding" = EXCLUDED."embedding", "updatedAt" = NOW(), "expiresAt" = EXCLUDED."expiresAt"
                    `;
                } else {
                    // The compound unique doesn't exist in the Prisma schema (uniqueness is a
                    // partial index on live rows, SQL-only), so upsert is replaced by
                    // find-live-then-update/create. Same blind-upsert semantics as before.
                    const live = await prisma.clawMemory.findFirst({
                        where: { tenantId, namespace, key, supersededById: null },
                        select: { id: true },
                    });
                    if (live) {
                        await prisma.clawMemory.updateMany({
                            where: { id: live.id, tenantId },
                            data: { value: value as Prisma.InputJsonValue, expiresAt, updatedAt: new Date() },
                        });
                    } else {
                        try {
                            await prisma.clawMemory.create({
                                data: { tenantId, userId, namespace, key, value: value as Prisma.InputJsonValue, kind: 'SEMANTIC', expiresAt },
                            });
                        } catch (err) {
                            // Concurrent create of the same live key — partial unique index is
                            // the backstop; retry once as an update of the winner.
                            if ((err as { code?: string })?.code === 'P2002') {
                                const winner = await prisma.clawMemory.findFirst({
                                    where: { tenantId, namespace, key, supersededById: null },
                                    select: { id: true },
                                });
                                if (winner) {
                                    await prisma.clawMemory.updateMany({
                                        where: { id: winner.id, tenantId },
                                        data: { value: value as Prisma.InputJsonValue, expiresAt, updatedAt: new Date() },
                                    });
                                } else {
                                    throw err;
                                }
                            } else {
                                throw err;
                            }
                        }
                    }
                }
                results.push(null);
            } else if (op.namespacePrefix !== undefined && op.query !== undefined) {
                // Search operation — SEMANTIC only (mirrors the put's hardcoded kind), and
                // scoped to live, unexpired rows (claw_memories tracks supersession/TTL,
                // unlike nucleus's flat agent_memories table this was ported from).
                const query = String(op.query);
                const limit = Number(op.limit ?? 5);
                const tenantId = configurable?.tenant_id as string ?? 'default';
                const namespacePrefix = Array.isArray(op.namespacePrefix)
                    ? (op.namespacePrefix as string[]).join('/')
                    : '';

                let queryEmbedding: number[] | null = null;
                try {
                    const emb = await this.getEmbeddings(tenantId);
                    queryEmbedding = await emb.embedQuery(query);
                } catch {
                    // no provider / embedding failure — fallback to text search
                }

                if (queryEmbedding) {
                    const embeddingStr = `[${queryEmbedding.join(',')}]`;
                    const rows = namespacePrefix
                        ? await prisma.$queryRaw<Array<{ key: string; value: unknown; namespace: string }>>`
                            SELECT "key", "value", "namespace"
                            FROM claw_memories
                            WHERE "tenantId" = ${tenantId}
                              AND "kind" = 'SEMANTIC'
                              AND "supersededById" IS NULL
                              AND "expiresAt" > NOW()
                              AND "namespace" LIKE ${namespacePrefix + '%'}
                            ORDER BY embedding <=> ${embeddingStr}::vector
                            LIMIT ${limit}
                          `
                        : await prisma.$queryRaw<Array<{ key: string; value: unknown; namespace: string }>>`
                            SELECT "key", "value", "namespace"
                            FROM claw_memories
                            WHERE "tenantId" = ${tenantId}
                              AND "kind" = 'SEMANTIC'
                              AND "supersededById" IS NULL
                              AND "expiresAt" > NOW()
                            ORDER BY embedding <=> ${embeddingStr}::vector
                            LIMIT ${limit}
                          `;
                    results.push(rows.map((r) => ({ key: r.key, value: r.value, namespace: r.namespace })));
                } else {
                    const baseWhere = { tenantId, kind: 'SEMANTIC' as const, supersededById: null, expiresAt: { gt: new Date() } };
                    const rows = namespacePrefix
                        ? await prisma.clawMemory.findMany({
                            where: { ...baseWhere, namespace: { startsWith: namespacePrefix } },
                            take: limit,
                            orderBy: { createdAt: 'desc' },
                          })
                        : await prisma.clawMemory.findMany({
                            where: baseWhere,
                            take: limit,
                            orderBy: { createdAt: 'desc' },
                          });
                    results.push(rows.map((r) => ({ key: r.key, value: r.value, namespace: r.namespace })));
                }
            } else {
                results.push(null);
            }
        }

        return results;
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function initPersistence(): Promise<PersistenceInstances> {
    const databaseUrl = env.DATABASE_URL;

    // PostgresSaver manages its own schema — call setup() on first use
    const checkpointer = PostgresSaver.fromConnString(databaseUrl);
    await checkpointer.setup();

    // Embeddings are resolved per-tenant from the configured provider inside
    // PostgresMemoryStore — no shared default embedder is created here.
    const store = new PostgresMemoryStore();

    logger.info({}, '[Persistence] Initialized PostgresSaver, PostgresMemoryStore');
    return { checkpointer, store };
}

async function getPersistence(): Promise<PersistenceInstances> {
    if (g._persistence) return g._persistence;
    if (!g._persistencePromise) {
        g._persistencePromise = initPersistence()
            .then((p) => {
                g._persistence = p;
                return p;
            })
            .catch((err) => {
                g._persistencePromise = undefined;
                logger.error({ error: err instanceof Error ? err.message : err }, '[Persistence] initPersistence failed');
                throw err;
            });
    }
    return g._persistencePromise;
}

// ─── Getters ──────────────────────────────────────────────────────────────────

export async function getCheckpointer(): Promise<PostgresSaver> {
    return (await getPersistence()).checkpointer;
}

export async function getMemoryStore(): Promise<PostgresMemoryStore> {
    return (await getPersistence()).store;
}

// ─── Memory helpers ───────────────────────────────────────────────────────────

export async function saveMemory(
    tenantId: string,
    userId: string,
    namespace: string[],
    key: string,
    value: Record<string, unknown>
): Promise<void> {
    await getMemoryService().remember({ tenantId, userId, kind: 'SEMANTIC', namespace, key, value });
}

export async function searchMemory(
    tenantId: string,
    userId: string,
    namespacePrefix: string[],
    query: string,
    limit = 5
): Promise<unknown[]> {
    const hits = await getMemoryService().recall({ tenantId, userId, query, namespacePrefix, limit });
    return hits.map((h) => ({ key: h.key, value: h.value, namespace: h.namespace }));
}

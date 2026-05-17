import { createLogger } from '@chatbot/shared/workers';
import type { RetrievalResult } from '../types';

const umapLogger = createLogger('kb:umap');

// ─── UMAP projection ──────────────────────────────────────────────────────────

export interface UmapPoint {
  id: string;
  x: number;
  y: number;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface UmapProjectionResult {
  points: UmapPoint[];
  computedAt: Date;
}

/**
 * Project high-dimensional embeddings to 2D using UMAP.
 * Requires the `umap-js` package at runtime.
 */
export async function projectEmbeddings(
  items: Array<{ id: string; embedding: number[]; label?: string; metadata?: Record<string, unknown> }>
): Promise<UmapProjectionResult> {
  if (items.length === 0) {
    return { points: [], computedAt: new Date() };
  }

  try {
    // @ts-ignore — umap-js is an optional peer dependency
    const { UMAP } = await import('umap-js').catch(() => {
      throw new Error('UMAP projection requires "umap-js". Install with: bun add umap-js');
    });

    const embeddings = items.map((item) => item.embedding);
    const umap = new UMAP({ nComponents: 2, nNeighbors: Math.min(15, items.length - 1) });
    const projection: number[][] = await umap.fitAsync(embeddings);

    const points: UmapPoint[] = items.map((item, i) => ({
      id: item.id,
      x: projection[i][0],
      y: projection[i][1],
      label: item.label,
      metadata: item.metadata,
    }));

    return { points, computedAt: new Date() };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    umapLogger.error({ itemCount: items.length, errorMessage: msg }, 'UMAP projection failed');
    if (msg.includes('umap-js')) throw err;
    throw new Error(`UMAP projection failed: ${msg}`);
  }
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

interface CacheEntry {
  result: UmapProjectionResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function getCachedProjection(key: string): UmapProjectionResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

export function setCachedProjection(
  key: string,
  result: UmapProjectionResult,
  ttlMs = DEFAULT_TTL_MS
): void {
  cache.set(key, { result, expiresAt: Date.now() + ttlMs });
}

export function clearProjectionCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

/**
 * Project embeddings with caching. The cache key is derived from the
 * knowledge base ID and the number of items.
 */
export async function projectEmbeddingsCached(
  knowledgeBaseId: string,
  items: Array<{ id: string; embedding: number[]; label?: string; metadata?: Record<string, unknown> }>,
  ttlMs?: number
): Promise<UmapProjectionResult> {
  const key = `${knowledgeBaseId}:${items.length}`;
  const cached = getCachedProjection(key);
  if (cached) return cached;

  const result = await projectEmbeddings(items);
  setCachedProjection(key, result, ttlMs);
  return result;
}

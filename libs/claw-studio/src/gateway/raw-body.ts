/**
 * raw-body.ts — read a request body once, reuse it everywhere.
 *
 * `validateRequest` needs the exact bytes (signatures are computed over the raw
 * body, so re-serializing JSON would break them) and `parseInbound` needs the
 * same body moments later. A Request body is a single-read stream, so the second
 * read would throw. Keyed by Request identity in a WeakMap, per the design
 * reference's §4 implementation note.
 */

const cache = new WeakMap<Request, Promise<string>>();

export function readRawBody(req: Request): Promise<string> {
  const existing = cache.get(req);
  if (existing) return existing;
  // Clone so an adapter that later wants req.formData()/json() itself still can.
  const promise = req.clone().text();
  cache.set(req, promise);
  return promise;
}

/** Parses `application/x-www-form-urlencoded` (Slack slash commands, interactivity). */
export function parseFormEncoded(raw: string): Record<string, string> {
  const params = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

export function parseJsonSafely<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

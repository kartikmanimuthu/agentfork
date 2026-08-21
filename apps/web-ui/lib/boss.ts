import PgBoss from 'pg-boss';

declare global {
  // eslint-disable-next-line no-var
  var __pgBoss: Promise<PgBoss> | undefined;
}

function bossOptions(): PgBoss.ConstructorOptions {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required');

  return {
    connectionString,
    retryLimit: 10,
    retryDelay: 30,
    retryBackoff: true,
    expireInHours: 4,
    archiveCompletedAfterSeconds: 86400,
    deleteAfterDays: 7,
  };
}

/**
 * Creates a NEW pg-boss instance. Callers are responsible for start()/stop().
 *
 * Prefer {@link getBoss} for anything on a hot path: `start()` opens a connection pool and
 * runs pg-boss schema checks, so doing it per request exhausts Postgres connections under
 * concurrency. This is retained for the routes that still follow the older
 * create/start/send/stop pattern.
 */
export function createBoss(): PgBoss {
  return new PgBoss(bossOptions());
}

/**
 * Returns the process-wide pg-boss instance, started exactly once.
 *
 * The promise (not the instance) is cached so concurrent first-callers all await the same
 * start() rather than racing to create their own pool. Never call stop() on the result —
 * it is shared for the lifetime of the process. Held on globalThis outside production so
 * Next.js hot reloads reuse it instead of leaking a pool per recompile.
 */
export function getBoss(): Promise<PgBoss> {
  if (!globalThis.__pgBoss) {
    globalThis.__pgBoss = (async () => {
      const boss = new PgBoss(bossOptions());
      boss.on('error', (err) => {
        console.error('[pg-boss] instance error', err);
      });
      await boss.start();
      return boss;
    })().catch((err) => {
      // Don't cache a failed start — let the next caller retry.
      globalThis.__pgBoss = undefined;
      throw err;
    });
  }
  return globalThis.__pgBoss;
}

/** Enqueue a job on the shared instance. This is what transcription routes inject downstream. */
export async function enqueueJob(name: string, data: Record<string, unknown>): Promise<void> {
  const boss = await getBoss();
  await boss.send(name, data);
}

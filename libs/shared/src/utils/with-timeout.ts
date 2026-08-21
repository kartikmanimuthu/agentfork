export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Races a promise against a timer. If the timer wins, rejects with TimeoutError instead of
 * leaving the caller waiting indefinitely — the original promise is NOT cancelled (there is
 * often no clean way to cancel a Prisma query or an in-flight stream mid-read), it just stops
 * being awaited. Use for operations with no native cancellation (DB queries); prefer an
 * AbortController tied directly into the call when one is available (e.g. the S3 SDK, fetch).
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

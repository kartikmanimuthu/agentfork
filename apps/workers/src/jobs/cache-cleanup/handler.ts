import { getPrismaClient } from '@chatbot/shared/workers';
import { ResponseCacheService, SemanticCacheService } from '@chatbot/shared';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('cache-cleanup');

export async function handleCacheCleanup(): Promise<void> {
  const db = getPrismaClient();

  try {
    const exact = await new ResponseCacheService(db as never).cleanupExpired();
    const semantic = await new SemanticCacheService(db as never).cleanupExpired();
    log.info({ exactRemoved: exact, semanticRemoved: semantic }, 'Expired cache entries swept');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error({ errorMessage: error.message, errorStack: error.stack }, 'Cache cleanup failed');
    throw error;
  }
}

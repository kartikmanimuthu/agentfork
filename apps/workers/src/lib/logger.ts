import { createLogger as createPinoLogger } from '@chatbot/shared/workers';
import { env } from '../env';

export function createLogger(context: string) {
  const logger = createPinoLogger(context);
  return {
    info: (msg: string, data?: Record<string, unknown>) =>
      logger.info(data ?? {}, msg),
    warn: (msg: string, data?: Record<string, unknown>) =>
      logger.warn(data ?? {}, msg),
    error: (msg: string, data?: Record<string, unknown>) =>
      logger.error(data ?? {}, msg),
    debug: (msg: string, data?: Record<string, unknown>) => {
      if (env.NODE_ENV !== 'production') {
        logger.debug(data ?? {}, msg);
      }
    },
  };
}

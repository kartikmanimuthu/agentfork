import { pino } from 'pino';
import { env } from '../env';

interface Logger {
  trace: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  fatal: (obj: unknown, msg?: string) => void;
  child: (bindings: Record<string, unknown>) => Logger;
  flush: () => void;
}

const noopLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
  flush: () => {},
};

let baseLogger: Logger | undefined;

function createBaseLogger(): Logger {
  const isDev = env.NODE_ENV !== 'production';

  return pino({
    level: env.LOG_LEVEL,
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    redact: {
      paths: [
        'password',
        'passwordHash',
        'token',
        'authorization',
        'cookie',
        'apiKey',
        '*.password',
        '*.passwordHash',
        '*.token',
        '*.authorization',
        '*.cookie',
        '*.apiKey',
      ],
      censor: '[Redacted]',
    },
  });
}

export function createLogger(context: string): Logger {
  if (typeof window !== 'undefined') {
    return noopLogger;
  }

  if (!baseLogger) {
    baseLogger = createBaseLogger();
  }

  return baseLogger.child({ context });
}

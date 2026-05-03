import { env } from '../env';

const noopLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
  flush: () => {},
};

type Logger = typeof noopLogger;

let baseLogger: Logger | undefined;

function createBaseLogger(): Logger {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pino = require('pino');
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

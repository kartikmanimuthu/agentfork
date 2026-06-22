import pino from 'pino';
import { env } from '../env';

type LogArgs =
  | [msg: string]
  | [msg: string, data: Record<string, unknown>]
  | [data: Record<string, unknown>, msg: string];

function parseArgs(args: LogArgs): [Record<string, unknown>, string] {
  if (args.length === 1) return [{}, args[0] as string];
  if (typeof args[0] === 'string') return [(args[1] as Record<string, unknown>) ?? {}, args[0]];
  return [args[0] as Record<string, unknown>, args[1] as string];
}

const isDev = env.NODE_ENV !== 'production';

const baseLogger = pino({
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

export function createLogger(context: string) {
  const logger = baseLogger.child({ context });
  return {
    info: (...args: LogArgs) => { const [data, msg] = parseArgs(args); logger.info(data, msg); },
    warn: (...args: LogArgs) => { const [data, msg] = parseArgs(args); logger.warn(data, msg); },
    error: (...args: LogArgs) => { const [data, msg] = parseArgs(args); logger.error(data, msg); },
    debug: (...args: LogArgs) => {
      if (env.NODE_ENV !== 'production') {
        const [data, msg] = parseArgs(args);
        logger.debug(data, msg);
      }
    },
  };
}

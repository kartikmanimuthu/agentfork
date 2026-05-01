export function createLogger(context: string) {
  const prefix = `[${context}]`;
  return {
    info: (msg: string, data?: Record<string, unknown>) =>
      console.log(JSON.stringify({ level: 'info', context, msg, ...data, ts: new Date().toISOString() })),
    warn: (msg: string, data?: Record<string, unknown>) =>
      console.warn(JSON.stringify({ level: 'warn', context, msg, ...data, ts: new Date().toISOString() })),
    error: (msg: string, data?: Record<string, unknown>) =>
      console.error(JSON.stringify({ level: 'error', context, msg, ...data, ts: new Date().toISOString() })),
    debug: (msg: string, data?: Record<string, unknown>) => {
      if (process.env.NODE_ENV !== 'production') {
        console.debug(JSON.stringify({ level: 'debug', context, msg, ...data, ts: new Date().toISOString() }));
      }
    },
  };
}

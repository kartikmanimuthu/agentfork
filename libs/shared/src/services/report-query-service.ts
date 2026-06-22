import { createLogger } from '../logging/logger';
import {
  REPORT_DB_ROLE,
  REPORT_TENANT_GUC,
  REPORT_ROW_LIMIT,
  REPORT_STATEMENT_TIMEOUT_MS,
  type ReportResult,
} from '../reports/report-viz';

const logger = createLogger('service:report-query');

/** Minimal transaction surface the runner needs (PrismaClient satisfies it). */
export interface ReportTx {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
}

export interface ReportQueryDb {
  $transaction: <T>(fn: (tx: ReportTx) => Promise<T>) => Promise<T>;
}

/** Thrown when the admin's SQL fails to execute (syntax, permission, timeout). */
export class ReportQueryError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ReportQueryError';
    this.code = code;
  }
}

/** Make a raw DB value JSON-serializable (BigInt, Date, Buffer). */
function serializeValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `\\x${Buffer.from(value).toString('hex')}`;
  return value;
}

/** Translate raw Postgres/Prisma errors into a safe, user-facing message. */
function toQueryError(error: unknown): ReportQueryError {
  const raw = error instanceof Error ? error.message : String(error);
  const codeMatch = raw.match(/Code:\s*`?(\w+)`?/);
  const code = codeMatch?.[1];
  if (code === '57014') return new ReportQueryError('Query exceeded the 10s time limit.', code);
  if (code === '42501')
    return new ReportQueryError(
      'Permission denied. Reports may only read the allow-listed reporting tables.',
      code,
    );
  // Surface the Postgres "Message:" line if present; otherwise a generic note.
  const msgMatch = raw.match(/Message:\s*`?([^`\n]+)`?/);
  const message = msgMatch?.[1]?.trim();
  return new ReportQueryError(message ? `Query error: ${message}` : 'Query failed.', code);
}

/**
 * Executes admin-authored read-only SQL inside an RLS-scoped transaction:
 *   SET LOCAL ROLE chatbot_report_ro  -> read-only, allow-listed tables only
 *   set_config('app.tenant_id', ...)  -> RLS pins rows to this tenant
 *   statement_timeout                 -> bounds runaway queries
 * The result is row-capped and JSON-sanitized for the API boundary.
 */
export class ReportQueryService {
  constructor(private readonly db: ReportQueryDb) {}

  async run(tenantId: string, sql: string): Promise<ReportResult> {
    const trimmed = sql.trim().replace(/;\s*$/, '');
    // Wrap so we can enforce a hard row cap regardless of the user's query, and
    // fetch one extra row to detect truncation. REPORT_ROW_LIMIT is a constant.
    const wrapped = `SELECT * FROM (${trimmed}) AS _report_sub LIMIT ${REPORT_ROW_LIMIT + 1}`;

    try {
      const rows = await this.db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${REPORT_DB_ROLE}`);
        await tx.$queryRawUnsafe('SELECT set_config($1, $2, true)', REPORT_TENANT_GUC, tenantId);
        await tx.$queryRawUnsafe(
          'SELECT set_config($1, $2, true)',
          'statement_timeout',
          String(REPORT_STATEMENT_TIMEOUT_MS),
        );
        await tx.$queryRawUnsafe(
          'SELECT set_config($1, $2, true)',
          'idle_in_transaction_session_timeout',
          '15000',
        );
        return (await tx.$queryRawUnsafe(wrapped)) as Record<string, unknown>[];
      });

      const truncated = rows.length > REPORT_ROW_LIMIT;
      const capped = truncated ? rows.slice(0, REPORT_ROW_LIMIT) : rows;
      const columns = capped.length > 0 ? Object.keys(capped[0]) : [];
      const cleaned = capped.map((row) => {
        const out: Record<string, unknown> = {};
        for (const key of columns) out[key] = serializeValue(row[key]);
        return out;
      });

      logger.info({ tenantId, rowCount: cleaned.length, truncated }, 'Report query executed');
      return { columns, rows: cleaned, rowCount: cleaned.length, truncated };
    } catch (error) {
      const queryError = toQueryError(error);
      logger.warn(
        { err: error, tenantId, code: queryError.code },
        'Report query failed',
      );
      throw queryError;
    }
  }
}

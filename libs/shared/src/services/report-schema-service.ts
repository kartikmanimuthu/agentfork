import { createLogger } from '../logging/logger';
import { REPORTABLE_TABLES } from '../reports/report-viz';
import type { ReportColumn, ReportTableSchema } from '../reports/report-viz';

const logger = createLogger('service:report-schema');

export type { ReportColumn, ReportTableSchema };

export interface ReportSchemaDb {
  $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
}

/**
 * Returns the column layout of the allow-listed reportable tables so the editor
 * can present a schema browser. Reads information_schema as the app role (this is
 * metadata only, and is filtered to the same allow-list the RLS role can read).
 */
export class ReportSchemaService {
  constructor(private readonly db: ReportSchemaDb) {}

  async introspect(): Promise<ReportTableSchema[]> {
    try {
      const rows = (await this.db.$queryRawUnsafe(
        `SELECT table_name, column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])
         ORDER BY table_name, ordinal_position`,
        REPORTABLE_TABLES as unknown as string[],
      )) as { table_name: string; column_name: string; data_type: string }[];

      const byTable = new Map<string, ReportColumn[]>();
      for (const r of rows) {
        const cols = byTable.get(r.table_name) ?? [];
        cols.push({ name: r.column_name, type: r.data_type });
        byTable.set(r.table_name, cols);
      }
      // Preserve allow-list ordering.
      return REPORTABLE_TABLES.filter((t) => byTable.has(t)).map((t) => ({
        table: t,
        columns: byTable.get(t)!,
      }));
    } catch (error) {
      logger.error({ err: error }, 'Failed to introspect report schema');
      throw error;
    }
  }
}

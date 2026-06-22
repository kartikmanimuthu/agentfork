import { z } from 'zod';

/**
 * Shared, client-safe types + constants for custom SQL reports.
 * No server-only imports here — this module is re-exported through
 * `@chatbot/shared/client` and used by the browser UI.
 */

/** Visualization kinds a report result can be rendered as. */
export const VIZ_TYPES = ['table', 'line', 'bar', 'area', 'pie', 'kpi'] as const;
// Named ReportVizType to avoid colliding with the dashboards module's VizType
// (which has no 'table' option) when both flow through @chatbot/shared.
export type ReportVizType = (typeof VIZ_TYPES)[number];

export const vizTypeSchema = z.enum(VIZ_TYPES);

/**
 * Maps result-set columns to chart axes.
 *  - xKey: column used for the X axis / category / pie label
 *  - yKeys: numeric column(s) plotted as series
 *  - seriesKey: optional column whose distinct values split a single yKey into series
 * For `table` viz this may be empty; for `kpi` the first numeric column is used.
 */
export const vizConfigSchema = z.object({
  xKey: z.string().max(200).optional(),
  yKeys: z.array(z.string().max(200)).max(20).default([]),
  seriesKey: z.string().max(200).optional(),
});
export type VizConfig = z.infer<typeof vizConfigSchema>;

/** A column in a reportable table (from schema introspection). */
export interface ReportColumn {
  name: string;
  type: string;
}
/** A reportable table and its columns. */
export interface ReportTableSchema {
  table: string;
  columns: ReportColumn[];
}

/** Result of executing a report query. */
export interface ReportResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  /** true when the result was capped at ROW_LIMIT. */
  truncated: boolean;
}

/**
 * v1 allow-list of reportable tables. Must stay in sync with the GRANT + RLS
 * policies in prisma/migrations/.../sql_reports/migration.sql. To add a table:
 * grant SELECT, add an RLS policy in a new migration, then add it here.
 */
export const REPORTABLE_TABLES = [
  'inference_sessions',
  'session_analytics',
  'agents',
  'agent_executions',
  'api_key_executions',
  'scores',
] as const;
export type ReportableTable = (typeof REPORTABLE_TABLES)[number];

/** Execution guardrails. */
export const MAX_SQL_LENGTH = 20_000;
export const REPORT_ROW_LIMIT = 1_000;
export const REPORT_STATEMENT_TIMEOUT_MS = 10_000;

/** Postgres objects created by the migration. */
export const REPORT_DB_ROLE = 'chatbot_report_ro';
export const REPORT_TENANT_GUC = 'app.tenant_id';

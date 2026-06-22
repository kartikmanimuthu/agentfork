import { describe, it, expect, vi } from 'vitest';
import {
  ReportQueryService,
  ReportQueryError,
  type ReportQueryDb,
  type ReportTx,
} from './report-query-service';

/**
 * Builds a mock DB whose $transaction runs the callback with a tx that returns
 * `rows` for the wrapped report query and empty results for the SET/config calls.
 */
function makeDb(rows: Record<string, unknown>[] | Error) {
  const exec = vi.fn().mockResolvedValue(0);
  const query = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('_report_sub')) {
      if (rows instanceof Error) throw rows;
      return Promise.resolve(rows);
    }
    return Promise.resolve([{ set_config: '' }]);
  });
  const tx: ReportTx = { $executeRawUnsafe: exec, $queryRawUnsafe: query };
  const db = {
    $transaction: vi.fn().mockImplementation((fn: (t: ReportTx) => unknown) => fn(tx)),
  } as unknown as ReportQueryDb;
  return { db, exec, query };
}

describe('ReportQueryService', () => {
  it('sets the RLS role, tenant GUC and statement timeout, then runs a row-capped query', async () => {
    const { db, exec, query } = makeDb([{ id: 'a', name: 'x' }]);
    const result = await new ReportQueryService(db).run('tenant-1', 'SELECT id, name FROM agents');

    expect(exec).toHaveBeenCalledWith('SET LOCAL ROLE chatbot_report_ro');
    // tenant GUC bound as a parameter (no interpolation)
    expect(query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', 'app.tenant_id', 'tenant-1');
    expect(query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', 'statement_timeout', '10000');
    // user SQL is wrapped with a hard LIMIT
    const wrapped = query.mock.calls.find((c) => String(c[0]).includes('_report_sub'))![0] as string;
    expect(wrapped).toContain('LIMIT 1001');
    expect(wrapped).toContain('SELECT id, name FROM agents');

    expect(result.columns).toEqual(['id', 'name']);
    expect(result.rowCount).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('strips a trailing semicolon before wrapping', async () => {
    const { db, query } = makeDb([{ x: 1 }]);
    await new ReportQueryService(db).run('t', 'SELECT 1 AS x;  ');
    const wrapped = query.mock.calls.find((c) => String(c[0]).includes('_report_sub'))![0] as string;
    expect(wrapped).not.toContain(';)');
    expect(wrapped).toContain('(SELECT 1 AS x)');
  });

  it('serializes BigInt values to numbers', async () => {
    const { db } = makeDb([{ status: 'completed', n: 9n }]);
    const result = await new ReportQueryService(db).run('t', 'SELECT status, count(*) n FROM agent_executions GROUP BY status');
    expect(result.rows[0]).toEqual({ status: 'completed', n: 9 });
  });

  it('caps rows at 1000 and flags truncation', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ i }));
    const { db } = makeDb(rows);
    const result = await new ReportQueryService(db).run('t', 'SELECT i FROM generate_series(1,2000) i');
    expect(result.rowCount).toBe(1000);
    expect(result.truncated).toBe(true);
  });

  it('maps permission-denied (42501) to a friendly ReportQueryError', async () => {
    const { db } = makeDb(new Error('Raw query failed. Code: `42501`. Message: `permission denied for table tenants`'));
    await expect(new ReportQueryService(db).run('t', 'SELECT * FROM tenants')).rejects.toMatchObject({
      name: 'ReportQueryError',
      code: '42501',
    });
  });

  it('maps statement timeout (57014) to a friendly message', async () => {
    const { db } = makeDb(new Error('Raw query failed. Code: `57014`. Message: `canceling statement due to statement timeout`'));
    await expect(new ReportQueryService(db).run('t', 'SELECT pg_sleep(60)')).rejects.toThrow(/10s time limit/);
  });

  it('returns empty columns for a zero-row result', async () => {
    const { db } = makeDb([]);
    const result = await new ReportQueryService(db).run('t', 'SELECT 1 WHERE false');
    expect(result).toEqual({ columns: [], rows: [], rowCount: 0, truncated: false });
  });

  it('wraps any thrown error as ReportQueryError', async () => {
    const { db } = makeDb(new Error('Raw query failed. Code: `42601`. Message: `syntax error at or near "FROM"`'));
    const err = await new ReportQueryService(db).run('t', 'SELECT FROM').catch((e) => e);
    expect(err).toBeInstanceOf(ReportQueryError);
    expect(err.message).toContain('syntax error');
  });
});

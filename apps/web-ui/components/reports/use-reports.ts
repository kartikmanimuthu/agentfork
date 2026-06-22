'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import type { ReportResult, ReportTableSchema } from '@/lib/reports/types';

/** Introspect the allow-listed reportable tables + columns. */
export function useReportSchema() {
  return useQuery({
    queryKey: ['report-schema'],
    queryFn: async (): Promise<{ tables: ReportTableSchema[] }> => {
      const res = await fetch('/api/reports/schema');
      if (!res.ok) throw new Error('Failed to load schema');
      return res.json();
    },
    staleTime: 1000 * 60 * 10,
  });
}

export interface RunReportError {
  type: string;
  message: string;
  code?: string;
}

/** Execute a SAVED report's SQL by id (read-gated — works for viewers). */
export function useRunSavedReport() {
  return useMutation<ReportResult, RunReportError, string>({
    mutationFn: async (id: string): Promise<ReportResult> => {
      const res = await fetch(`/api/reports/${id}/run`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const err: RunReportError = body?.error ?? { type: 'error', message: 'Query failed' };
        throw err;
      }
      return body.result as ReportResult;
    },
  });
}

/** Execute ad-hoc SQL and return a result set (or a typed query error). */
export function useRunReport() {
  return useMutation<ReportResult, RunReportError, string>({
    mutationFn: async (sql: string): Promise<ReportResult> => {
      const res = await fetch('/api/reports/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const err: RunReportError = body?.error ?? { type: 'error', message: 'Query failed' };
        throw err;
      }
      return body.result as ReportResult;
    },
  });
}

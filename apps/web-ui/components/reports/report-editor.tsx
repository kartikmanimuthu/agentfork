'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Play, Save, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { createReportSchema } from '@chatbot/shared/client';
import { useReportSchema, useRunReport, useRunSavedReport } from './use-reports';
import { SchemaExplorer } from './schema-explorer';
import { ResultTable } from './result-table';
import { ReportChart } from './report-chart';
import { VizMapper } from './viz-mapper';
import type { ReportDTO, ReportResult, VizType, VizConfig } from '@/lib/reports/types';

interface Props {
  reportId?: string;
  initial?: ReportDTO;
}

export function ReportEditor({ reportId, initial }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const sqlRef = useRef<HTMLTextAreaElement>(null);

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [sql, setSql] = useState(initial?.sqlText ?? 'SELECT * FROM agents LIMIT 50');
  const [vizType, setVizType] = useState<VizType>(initial?.vizType ?? 'table');
  const [vizConfig, setVizConfig] = useState<VizConfig>(initial?.vizConfig ?? { yKeys: [] });
  const [result, setResult] = useState<ReportResult | null>(null);

  const schema = useReportSchema();
  const run = useRunReport();
  const runSaved = useRunSavedReport();

  // Auto-load a saved report's result on open so the chart shows immediately
  // (and so read-only members, who can't run ad-hoc SQL, can still view it).
  useEffect(() => {
    if (!reportId) return;
    runSaved.mutate(reportId, { onSuccess: (res) => setResult(res) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  const runQuery = () => {
    run.mutate(sql, {
      onSuccess: (res) => setResult(res),
    });
  };

  const insertAtCursor = (text: string) => {
    const el = sqlRef.current;
    if (!el) {
      setSql((s) => `${s}${text}`);
      return;
    }
    const start = el.selectionStart ?? sql.length;
    const end = el.selectionEnd ?? sql.length;
    const next = `${sql.slice(0, start)}${text}${sql.slice(end)}`;
    setSql(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name, description: description || undefined, sqlText: sql, vizType, vizConfig };
      // validate client-side with the shared schema before submitting
      const parsed = createReportSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Invalid report');
      }
      const url = reportId ? `/api/reports/${reportId}` : '/api/reports';
      const method = reportId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) throw new Error('Failed to save report');
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['reports'] });
      toast.success('Report saved');
      if (!reportId && data?.report?.id) router.push(`/reports/${data.report.id}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to save report'),
  });

  const columns = result?.columns ?? [];

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/reports')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Untitled report"
          maxLength={100}
          className="max-w-xs font-medium"
        />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          maxLength={500}
          className="max-w-sm text-sm"
        />
        <div className="ml-auto">
          <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
            <Save className="mr-1 h-4 w-4" /> Save
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Schema explorer */}
        <aside className="w-56 shrink-0 overflow-auto border-r">
          <SchemaExplorer
            tables={schema.data?.tables ?? []}
            isLoading={schema.isLoading}
            onInsert={insertAtCursor}
            onQuery={setSql}
          />
        </aside>

        {/* Main */}
        <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto p-4">
          <Card>
            <CardContent className="space-y-2 p-3">
              <Textarea
                ref={sqlRef}
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                placeholder="SELECT ... FROM agents"
                spellCheck={false}
                className="min-h-32 font-mono text-sm"
              />
              <div className="flex items-center gap-2">
                <Button onClick={runQuery} disabled={run.isPending || !sql.trim()} size="sm">
                  <Play className="mr-1 h-4 w-4" /> {run.isPending ? 'Running…' : 'Run'}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Read-only · scoped to your tenant · 10s limit · max 1000 rows
                </span>
              </div>
              {run.isError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{run.error?.message ?? 'Query failed'}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {result && (
            <Card className="flex min-h-0 flex-1 flex-col">
              <CardContent className="flex min-h-0 flex-1 flex-col p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant="secondary">{result.rowCount} rows</Badge>
                  {result.truncated && <Badge variant="outline">truncated to 1000</Badge>}
                </div>
                <Tabs
                  defaultValue={vizType === 'table' ? 'table' : 'chart'}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <TabsList>
                    <TabsTrigger value="table">Table</TabsTrigger>
                    <TabsTrigger value="chart">Chart</TabsTrigger>
                  </TabsList>
                  <TabsContent value="table" className="min-h-0 flex-1 overflow-auto">
                    <ResultTable result={result} />
                  </TabsContent>
                  <TabsContent value="chart" className="min-h-0 flex-1">
                    <div className="flex h-full min-h-72 gap-4">
                      <div className="w-56 shrink-0 overflow-auto">
                        <VizMapper
                          columns={columns}
                          vizType={vizType}
                          vizConfig={vizConfig}
                          onVizTypeChange={setVizType}
                          onVizConfigChange={setVizConfig}
                        />
                      </div>
                      <div className="min-h-72 flex-1 rounded-md border p-3">
                        {vizType === 'table' ? (
                          <ResultTable result={result} />
                        ) : (
                          <ReportChart result={result} vizType={vizType} vizConfig={vizConfig} />
                        )}
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}

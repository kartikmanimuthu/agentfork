'use client';

import { useMemo, useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useRegistry } from './use-registry';
import { useWidgetData } from './use-widget-data';
import { WidgetRenderer } from './widget-renderer';
import type { VizType, WidgetQuerySpec } from '@/lib/dashboards/types';

const VIZ_TYPES: VizType[] = ['line', 'area', 'bar', 'pie', 'kpi'];
const PRESETS = [
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' },
] as const;

export interface WidgetBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: { title: string; querySpec: WidgetQuerySpec; layout: { x: number; y: number; w: number; h: number } }) => void;
  initialSpec?: WidgetQuerySpec;
  initialTitle?: string;
}

export function WidgetBuilder({ open, onOpenChange, onSave, initialSpec, initialTitle }: WidgetBuilderProps) {
  const { data: registry } = useRegistry();
  const sources = registry?.sources ?? [];

  const [title, setTitle] = useState('Untitled widget');
  const [sourceKey, setSourceKey] = useState<string>('');
  const [metricKey, setMetricKey] = useState<string>('');
  const [dimension, setDimension] = useState<string>('none');
  const [timeBucket, setTimeBucket] = useState<string>('none');
  const [preset, setPreset] = useState<'last_7d' | 'last_30d' | 'last_90d'>('last_30d');
  const [vizType, setVizType] = useState<VizType>('bar');
  const [filters, setFilters] = useState<Array<{ field: string; op: 'eq' | 'in'; value: string }>>([]);

  // Fix 2: Initialize state from initialSpec/initialTitle when the sheet opens
  useEffect(() => {
    if (!open) return;
    if (initialTitle) setTitle(initialTitle);
    if (initialSpec) {
      setSourceKey(initialSpec.source);
      setMetricKey(initialSpec.metric.key);
      setDimension(initialSpec.dimension ?? 'none');
      setTimeBucket(initialSpec.timeBucket ?? 'none');
      setPreset(
        'preset' in initialSpec.dateRange
          ? initialSpec.dateRange.preset
          : 'last_30d',
      );
      setVizType(initialSpec.vizType);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const source = sources.find((s) => s.key === sourceKey);
  const metric = source?.metrics.find((m) => m.key === metricKey);

  const spec: WidgetQuerySpec | null = useMemo(() => {
    if (!source || !metric) return null;
    return {
      source: source.key,
      metric: { key: metric.key },
      dimension: dimension !== 'none' && timeBucket === 'none' ? dimension : undefined,
      timeBucket: timeBucket !== 'none' ? (timeBucket as 'day' | 'week' | 'month') : undefined,
      filters: filters.filter(f => f.field && f.value).map(f => ({ field: f.field, op: f.op, value: f.value })),
      dateRange: { preset },
      vizType,
    } as WidgetQuerySpec;
  }, [source, metric, dimension, timeBucket, preset, vizType, filters]);

  const { data, isLoading, error } = useWidgetData(open ? spec : null);

  const validViz = metric?.validViz ?? VIZ_TYPES;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add widget</SheetTitle>
        </SheetHeader>

        <div className="grid grid-cols-1 gap-6 py-4 md:grid-cols-2">
          {/* config */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Data source</Label>
              {/* Fix 1 (source change): reset vizType to 'bar' when source changes */}
              <Select value={sourceKey} onValueChange={(v) => { setSourceKey(v); setMetricKey(''); setDimension('none'); setVizType('bar'); setFilters([]); }}>
                <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                <SelectContent>
                  {sources.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Metric</Label>
              {/* Fix 1 (metric change): reset vizType to first valid viz for the new metric */}
              <Select
                value={metricKey}
                onValueChange={(v) => {
                  setMetricKey(v);
                  const newMetric = source?.metrics.find(m => m.key === v);
                  if (newMetric && newMetric.validViz.length > 0) {
                    setVizType(newMetric.validViz[0]);
                  }
                }}
                disabled={!source}
              >
                <SelectTrigger><SelectValue placeholder="Select metric" /></SelectTrigger>
                <SelectContent>
                  {source?.metrics.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Group by</Label>
              <Select value={dimension} onValueChange={setDimension} disabled={!source || timeBucket !== 'none'}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {source?.dimensions.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Time bucket</Label>
              <Select value={timeBucket} onValueChange={(v) => { setTimeBucket(v); if (v !== 'none') setDimension('none'); }} disabled={!source}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="day">Day</SelectItem>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Fix 3: Filters section */}
            <div className="space-y-1.5">
              <Label>Filters</Label>
              <div className="space-y-2">
                {filters.map((f, i) => (
                  <div key={i} className="flex gap-1">
                    <Select value={f.field} onValueChange={(v) => setFilters(prev => prev.map((x, j) => j === i ? { ...x, field: v } : x))}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Field" /></SelectTrigger>
                      <SelectContent>
                        {source?.filters.map(fd => <SelectItem key={fd.key} value={fd.key}>{fd.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={f.op} onValueChange={(v) => setFilters(prev => prev.map((x, j) => j === i ? { ...x, op: v as 'eq' | 'in' } : x))}>
                      <SelectTrigger className="w-16"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="eq">=</SelectItem>
                        <SelectItem value="in">in</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input className="flex-1" value={f.value} onChange={(e) => setFilters(prev => prev.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="value" />
                    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setFilters(prev => prev.filter((_, j) => j !== i))}>×</Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" disabled={!source} onClick={() => setFilters(prev => [...prev, { field: source!.filters[0]?.key ?? '', op: 'eq', value: '' }])}>
                  + Add filter
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Date range</Label>
              <Select value={preset} onValueChange={(v) => setPreset(v as typeof preset)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Visualization</Label>
              <Select value={vizType} onValueChange={(v) => setVizType(v as VizType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VIZ_TYPES.map((v) => <SelectItem key={v} value={v} disabled={!validViz.includes(v)}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
            </div>
          </div>

          {/* preview */}
          <div className="rounded-lg border bg-card p-3">
            <div className="mb-2 text-sm font-medium">{title}</div>
            <div className="h-64">
              {!spec ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Pick a source and metric</div>
              ) : isLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
              ) : error ? (
                <div className="flex h-full items-center justify-center text-sm text-destructive">Query error</div>
              ) : (
                <WidgetRenderer vizType={vizType} data={data?.rows ?? []} />
              )}
            </div>
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!spec || !title.trim()}
            onClick={() => { if (spec) { onSave({ title: title.trim(), querySpec: spec, layout: { x: 0, y: Infinity, w: 6, h: 6 } }); onOpenChange(false); } }}
          >
            Save widget
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ReportResult } from '@/lib/reports/types';

type SortDir = 'asc' | 'desc';
type FilterOp = '=' | '≠';
interface Filter {
  col: string;
  op: FilterOp;
  value: unknown;
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function compare(a: unknown, b: unknown): number {
  const na = toNum(a);
  const nb = toNum(b);
  if (na !== null && nb !== null) return na - nb;
  return renderCell(a).localeCompare(renderCell(b));
}

export function ResultTable({ result }: { result: ReportResult }) {
  const [sort, setSort] = useState<{ col: string; dir: SortDir } | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // The header/cell the user right-clicked, captured before the menu opens.
  const [active, setActive] = useState<{ col: string; rowIdx: number | null }>({ col: '', rowIdx: null });

  const visibleColumns = useMemo(
    () => result.columns.filter((c) => !hidden.has(c)),
    [result.columns, hidden],
  );

  const rows = useMemo(() => {
    let out = result.rows;
    for (const f of filters) {
      out = out.filter((r) => {
        const eq = renderCell(r[f.col]) === renderCell(f.value);
        return f.op === '=' ? eq : !eq;
      });
    }
    if (sort) {
      const { col, dir } = sort;
      out = [...out].sort((a, b) => (dir === 'asc' ? compare(a[col], b[col]) : compare(b[col], a[col])));
    }
    return out;
  }, [result.rows, filters, sort]);

  const addFilter = (col: string, op: FilterOp, value: unknown) =>
    setFilters((prev) => [...prev.filter((f) => !(f.col === col && f.op === op)), { col, op, value }]);

  const hideColumn = (col: string) => setHidden((prev) => new Set(prev).add(col));
  const resetAll = () => {
    setSort(null);
    setFilters([]);
    setHidden(new Set());
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Copy failed');
    }
  };

  const summarize = (col: string, kind: 'count' | 'distinct' | 'sum' | 'avg' | 'min' | 'max') => {
    const values = rows.map((r) => r[col]);
    if (kind === 'count') return toast.success(`Count of ${col}: ${values.length.toLocaleString()}`);
    if (kind === 'distinct') {
      const set = new Set(values.map((v) => renderCell(v)));
      return toast.success(`Distinct ${col}: ${set.size.toLocaleString()}`);
    }
    const nums = values.map(toNum).filter((n): n is number => n !== null);
    if (nums.length === 0) return toast.error(`${col} has no numeric values`);
    let res: number;
    if (kind === 'sum') res = nums.reduce((a, b) => a + b, 0);
    else if (kind === 'avg') res = nums.reduce((a, b) => a + b, 0) / nums.length;
    else if (kind === 'min') res = Math.min(...nums);
    else res = Math.max(...nums);
    toast.success(`${kind} of ${col}: ${res.toLocaleString(undefined, { maximumFractionDigits: 4 })}`);
  };

  if (result.columns.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Query returned no columns.
      </div>
    );
  }

  const onContextMenuCapture = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-col]') as HTMLElement | null;
    if (!el) return;
    const col = el.dataset.col ?? '';
    const rowIdx = el.dataset.rowidx !== undefined ? Number(el.dataset.rowidx) : null;
    setActive({ col, rowIdx });
  };

  const activeCol = active.col;
  const isCell = active.rowIdx !== null;
  const cellValue = isCell ? rows[active.rowIdx as number]?.[activeCol] : undefined;
  const hasTransforms = sort !== null || filters.length > 0 || hidden.size > 0;

  return (
    <div className="space-y-2">
      {hasTransforms && (
        <div className="flex flex-wrap items-center gap-1.5">
          {sort && (
            <Badge variant="secondary" className="gap-1">
              {sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
              {sort.col}
              <button onClick={() => setSort(null)} aria-label="Clear sort">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.map((f, i) => (
            <Badge key={i} variant="secondary" className="gap-1">
              {f.col} {f.op} {renderCell(f.value) || '∅'}
              <button onClick={() => setFilters((p) => p.filter((_, j) => j !== i))} aria-label="Remove filter">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {[...hidden].map((c) => (
            <Badge key={c} variant="outline" className="gap-1">
              {c} hidden
              <button
                onClick={() => setHidden((p) => { const n = new Set(p); n.delete(c); return n; })}
                aria-label="Unhide column"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={resetAll}>
            Reset
          </Button>
          <span className="text-xs text-muted-foreground">
            {rows.length} of {result.rows.length} rows
          </span>
        </div>
      )}

      <ContextMenu>
        <ContextMenuTrigger onContextMenuCapture={onContextMenuCapture}>
          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {visibleColumns.map((c) => (
                    <TableHead
                      key={c}
                      data-col={c}
                      className="cursor-context-menu whitespace-nowrap font-mono text-xs"
                      onClick={() =>
                        setSort((s) =>
                          s?.col === c
                            ? { col: c, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                            : { col: c, dir: 'asc' },
                        )
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {c}
                        {sort?.col === c &&
                          (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={i}>
                    {visibleColumns.map((c) => (
                      <TableCell
                        key={c}
                        data-col={c}
                        data-rowidx={i}
                        className="cursor-context-menu whitespace-nowrap font-mono text-xs tabular-nums"
                      >
                        {renderCell(row[c])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="w-56">
          <div className="truncate px-1.5 py-1 font-mono text-xs font-medium text-muted-foreground">
            {isCell ? `${activeCol} = ${renderCell(cellValue) || '∅'}` : activeCol || 'Column'}
          </div>
          <ContextMenuSeparator />

          {isCell && (
            <>
              <ContextMenuItem onClick={() => addFilter(activeCol, '=', cellValue)}>
                Filter “{activeCol}” = this value
              </ContextMenuItem>
              <ContextMenuItem onClick={() => addFilter(activeCol, '≠', cellValue)}>
                Filter “{activeCol}” ≠ this value
              </ContextMenuItem>
              <ContextMenuItem onClick={() => copy(renderCell(cellValue))}>Copy value</ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}

          <ContextMenuItem onClick={() => setSort({ col: activeCol, dir: 'asc' })}>
            <ArrowUp className="mr-2 h-4 w-4" /> Sort ascending
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setSort({ col: activeCol, dir: 'desc' })}>
            <ArrowDown className="mr-2 h-4 w-4" /> Sort descending
          </ContextMenuItem>

          <ContextMenuSub>
            <ContextMenuSubTrigger>Summarize</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onClick={() => summarize(activeCol, 'count')}>Count rows</ContextMenuItem>
              <ContextMenuItem onClick={() => summarize(activeCol, 'distinct')}>Distinct values</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => summarize(activeCol, 'sum')}>Sum</ContextMenuItem>
              <ContextMenuItem onClick={() => summarize(activeCol, 'avg')}>Average</ContextMenuItem>
              <ContextMenuItem onClick={() => summarize(activeCol, 'min')}>Min</ContextMenuItem>
              <ContextMenuItem onClick={() => summarize(activeCol, 'max')}>Max</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => hideColumn(activeCol)}>Hide column</ContextMenuItem>
          <ContextMenuItem onClick={() => copy(activeCol)}>Copy column name</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

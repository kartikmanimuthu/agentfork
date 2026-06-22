'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronRight, Table2, Columns3 } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import type { ReportTableSchema } from '@/lib/reports/types';

/**
 * Collapsible list of reportable tables + columns.
 * Left-click inserts the name at the cursor; right-click opens a context menu
 * (query the table, insert, copy).
 */
export function SchemaExplorer({
  tables,
  isLoading,
  onInsert,
  onQuery,
}: {
  tables: ReportTableSchema[];
  isLoading: boolean;
  onInsert: (text: string) => void;
  onQuery: (sql: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // The table/column the user right-clicked, captured before the menu opens.
  const [active, setActive] = useState<{ kind: 'table' | 'column'; name: string; table: string } | null>(null);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Copy failed');
    }
  };

  if (isLoading) {
    return <p className="p-3 text-xs text-muted-foreground">Loading schema…</p>;
  }
  if (!tables.length) {
    return <p className="p-3 text-xs text-muted-foreground">No reportable tables.</p>;
  }

  const onContextMenuCapture = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-kind]') as HTMLElement | null;
    if (!el) {
      setActive(null);
      return;
    }
    setActive({
      kind: el.dataset.kind as 'table' | 'column',
      name: el.dataset.name ?? '',
      table: el.dataset.table ?? '',
    });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger onContextMenuCapture={onContextMenuCapture}>
        <div className="space-y-0.5 p-2 text-sm">
          <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">Reportable tables</p>
          {tables.map((t) => {
            const isOpen = open[t.table] ?? false;
            return (
              <div key={t.table}>
                <div
                  data-kind="table"
                  data-name={t.table}
                  className="flex w-full items-center gap-1 rounded px-1 py-1 hover:bg-accent"
                >
                  <button
                    type="button"
                    className="flex shrink-0 items-center"
                    onClick={() => setOpen((s) => ({ ...s, [t.table]: !isOpen }))}
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                  >
                    <ChevronRight className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-90')} />
                  </button>
                  <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    className="truncate font-mono text-xs hover:underline"
                    onClick={() => onInsert(t.table)}
                    title="Insert table name"
                  >
                    {t.table}
                  </button>
                </div>
                {isOpen && (
                  <ul className="ml-5 border-l pl-2">
                    {t.columns.map((c) => (
                      <li key={c.name}>
                        <button
                          type="button"
                          data-kind="column"
                          data-name={c.name}
                          data-table={t.table}
                          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-accent"
                          onClick={() => onInsert(c.name)}
                          title={`Insert "${c.name}" (${c.type})`}
                        >
                          <Columns3 className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate font-mono text-xs">{c.name}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{c.type}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        <div className="truncate px-1.5 py-1 font-mono text-xs font-medium text-muted-foreground">
          {active ? (active.kind === 'column' ? `${active.table}.${active.name}` : active.name) : 'Schema'}
        </div>
        <ContextMenuSeparator />
        {active?.kind === 'table' && (
          <>
            <ContextMenuItem onClick={() => onQuery(`SELECT * FROM ${active.name} LIMIT 50`)}>
              Query this table
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onQuery(`SELECT count(*) FROM ${active.name}`)}>
              Count rows
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={() => active && onInsert(active.name)}>Insert name</ContextMenuItem>
        <ContextMenuItem onClick={() => active && copy(active.name)}>Copy name</ContextMenuItem>
        {active?.kind === 'column' && (
          <ContextMenuItem onClick={() => copy(`${active.table}.${active.name}`)}>
            Copy qualified name
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

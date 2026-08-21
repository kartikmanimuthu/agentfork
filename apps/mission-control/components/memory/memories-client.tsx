'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Brain, Eye, Trash2, Search, X, Sparkles, Download, FileDown, FileCode, FileArchive, ChevronDown, Loader2, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeaderTitle } from '@/components/ui/page-header';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMemories, useDeleteMemory, fetchAllMemories, type MemoryRow, type MemoryKind } from '@/hooks/use-memories';
import { useDebounce } from '@/hooks/use-debounce';
import { MemoryDetailDialog } from './memory-detail-dialog';
import { DeleteMemoryDialog } from './delete-memory-dialog';
import { SkillFormDialog } from '@/components/skills/skill-form-dialog';
import { buildSkillDraftFromMemory, type SkillDraft } from '@chatbot/claw-studio/skills/promote';
import {
  exportMemoryToMarkdown,
  exportAllMemoriesToMarkdown,
  exportMemoryToFile,
  exportAllMemoriesToZip,
} from '@chatbot/claw-studio/memory/memory-export';

const KIND_OPTIONS: MemoryKind[] = ['SEMANTIC', 'EPISODIC', 'PROCEDURAL'];

function stringField(value: Record<string, unknown> | undefined, key: string): string | null {
  const v = value?.[key];
  return typeof v === 'string' && v.length ? v : null;
}

/** One-line, kind-aware summary for the list view. */
function summaryForRow(row: MemoryRow): string {
  const v = row.value;
  if (row.kind === 'SEMANTIC') return stringField(v, 'fact') ?? '—';
  if (row.kind === 'EPISODIC') return stringField(v, 'outcome') ?? '—';
  return stringField(v, 'instruction') ?? '—';
}

function confidenceVariant(c: string | null): 'default' | 'secondary' | 'outline' {
  if (c === 'high') return 'default';
  if (c === 'medium') return 'secondary';
  return 'outline';
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function MemoriesClient() {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, 300);
  const [kinds, setKinds] = useState<MemoryKind[]>([]);
  const [detail, setDetail] = useState<MemoryRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemoryRow | null>(null);
  const [promote, setPromote] = useState<{ draft: SkillDraft; sourceRunId: string | null } | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data, isLoading } = useMemories({ kinds: kinds.length ? kinds : undefined, search: search || undefined });
  const memories = data?.data ?? [];
  const total = data?.total ?? 0;
  const del = useDeleteMemory();

  const toggleKind = (kind: MemoryKind, checked: boolean) => {
    setKinds((prev) => (checked ? [...prev, kind] : prev.filter((k) => k !== kind)));
  };
  const clearFilters = () => {
    setSearchInput('');
    setKinds([]);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    del.mutate(target.id, {
      onSuccess: () => {
        toast.success('Memory deleted', { description: target.key });
        setDeleteTarget(null);
      },
      onError: (e) => {
        toast.error('Failed to delete memory', { description: e instanceof Error ? e.message : undefined });
      },
    });
  };

  const runExportAll = async (mode: 'report' | 'zip') => {
    if (exporting) return;
    setExporting(true);
    try {
      const { memories: all, total: knownTotal } = await fetchAllMemories();
      if (all.length === 0) {
        toast.error('Nothing to export', { description: 'No memories found.' });
        return;
      }
      if (all.length < knownTotal) {
        toast.warning('Export truncated', { description: `Exported ${all.length} of ${knownTotal} records (500-row cap).` });
      }
      if (mode === 'report') {
        exportAllMemoriesToMarkdown(all);
        toast.success('Memories exported', { description: `${all.length} record(s) downloaded` });
      } else {
        await exportAllMemoriesToZip(all);
        toast.success('Memories exported', { description: `${all.length} file(s) zipped` });
      }
    } catch (e) {
      toast.error('Export failed', { description: e instanceof Error ? e.message : 'Try again' });
    } finally {
      setExporting(false);
    }
  };

  const columns = useMemo<ColumnDef<MemoryRow>[]>(() => [
    {
      accessorKey: 'kind',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Kind" />,
      cell: ({ row }) => <Badge variant="outline">{row.original.kind}</Badge>,
    },
    {
      accessorKey: 'key',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Key" />,
      cell: ({ row }) => (
        <button type="button" onClick={() => setDetail(row.original)} className="text-left font-medium hover:underline">
          {row.original.key}
        </button>
      ),
    },
    {
      id: 'summary',
      header: 'Summary',
      enableSorting: false,
      cell: ({ row }) => <span className="block max-w-md truncate">{summaryForRow(row.original)}</span>,
    },
    {
      id: 'confidence',
      header: 'Confidence',
      enableSorting: false,
      cell: ({ row }) => {
        const c = stringField(row.original.value, 'confidence');
        return c ? <Badge variant={confidenceVariant(c)}>{c}</Badge> : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
      cell: ({ row }) => <span className="whitespace-nowrap text-sm text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
      sortingFn: 'datetime',
    },
    {
      accessorKey: 'updatedAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" />,
      cell: ({ row }) => <span className="whitespace-nowrap text-sm text-muted-foreground">{formatDateTime(row.original.updatedAt)}</span>,
      sortingFn: 'datetime',
    },
    {
      id: 'actions',
      header: () => <div className="text-right">Actions</div>,
      enableSorting: false,
      cell: ({ row }) => {
        const m = row.original;
        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" className="h-8 w-8 p-0" aria-label="Open actions menu">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDetail(m)}><Eye className="mr-2 h-4 w-4" /> View details</DropdownMenuItem>
                {m.kind === 'PROCEDURAL' ? (
                  <DropdownMenuItem
                    onClick={() => {
                      const draft = buildSkillDraftFromMemory(m);
                      if (draft) setPromote({ draft, sourceRunId: m.sourceThreadId });
                      else toast.error("This memory is missing rule fields and can't be promoted");
                    }}
                  >
                    <Sparkles className="mr-2 h-4 w-4" /> Promote to skill
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  onClick={() => {
                    try {
                      exportMemoryToMarkdown(m);
                      toast.success('Memory exported', { description: `${m.key}.md downloaded` });
                    } catch (e) {
                      toast.error('Export failed', { description: e instanceof Error ? e.message : 'Try again' });
                    }
                  }}
                >
                  <FileDown className="mr-2 h-4 w-4" /> Export markdown
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    try {
                      exportMemoryToFile(m);
                      toast.success('Memory file exported', { description: `${m.id}.md downloaded` });
                    } catch (e) {
                      toast.error('Export failed', { description: e instanceof Error ? e.message : 'Try again' });
                    }
                  }}
                >
                  <FileCode className="mr-2 h-4 w-4" /> Export memory (.md)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDeleteTarget(m)} className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const hasFilters = search.length > 0 || kinds.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeaderTitle
          icon={Brain}
          title="Memory"
          description="What Claw has learned across sessions. Review and prune as needed."
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" disabled={exporting || isLoading || total === 0}>
                {exporting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                Export all
                <ChevronDown className="w-4 h-4 ml-1" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => runExportAll('report')}><FileDown className="mr-2 h-4 w-4" /> Markdown (one file)</DropdownMenuItem>
            <DropdownMenuItem onClick={() => runExportAll('zip')}><FileArchive className="mr-2 h-4 w-4" /> Portable .md (zip)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <DataTable
        columns={columns}
        data={memories}
        loading={isLoading}
        enableFiltering={false}
        defaultPageSize={10}
        emptyMessage={hasFilters ? 'No memories match your filters.' : 'No memories yet — Claw will populate these as it works.'}
        header={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search key or fact…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="pl-9" />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" className="h-9">
                    Kind{kinds.length ? ` (${kinds.length})` : ''}
                  </Button>
                }
              />
              <DropdownMenuContent align="start">
                {KIND_OPTIONS.map((kind) => (
                  <DropdownMenuCheckboxItem key={kind} checked={kinds.includes(kind)} onCheckedChange={(c) => toggleKind(kind, c)}>
                    {kind}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 px-2 lg:px-3">
                Reset <X className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        }
      />

      <MemoryDetailDialog memory={detail} onClose={() => setDetail(null)} />
      <DeleteMemoryDialog target={deleteTarget} pending={del.isPending} onCancel={() => setDeleteTarget(null)} onConfirm={handleDelete} />
      <SkillFormDialog
        open={!!promote}
        onOpenChange={(v) => { if (!v) setPromote(null); }}
        initialDraft={promote?.draft ?? null}
        sourceRunId={promote?.sourceRunId ?? null}
      />
    </div>
  );
}

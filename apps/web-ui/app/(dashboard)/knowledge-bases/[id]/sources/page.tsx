'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ArrowLeft,
  Plus,
  RefreshCw,
  Play,
  Trash2,
  AlertCircle,
  Link2,
  Globe,
  Database,
  Plug,
  Upload,
  Eye,
  Pencil,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface DataSource {
  id: string;
  knowledgeBaseId: string;
  type: 'FILE' | 'URL' | 'CONNECTOR';
  config: Record<string, unknown>;
  status: 'active' | 'syncing' | 'error' | 'disabled';
  lastSyncAt: string | null;
  syncSchedule: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

const TYPE_BADGES: Record<
  DataSource['type'],
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; icon: React.ElementType }
> = {
  FILE: { label: 'FILE', variant: 'secondary', icon: Database },
  URL: { label: 'URL', variant: 'default', icon: Globe },
  CONNECTOR: { label: 'CONNECTOR', variant: 'outline', icon: Plug },
};

const STATUS_BADGES: Record<
  DataSource['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  active: 'default',
  syncing: 'secondary',
  error: 'destructive',
  disabled: 'outline',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function formatScheduleLabel(schedule: string | null): string {
  if (!schedule) return 'Manual';
  const map: Record<string, string> = {
    'manual': 'Manual',
    '0 * * * *': 'Hourly',
    '0 2 * * *': 'Daily',
    '0 2 * * 0': 'Weekly',
    '0 2 1 * *': 'Monthly',
  };
  return map[schedule] ?? schedule;
}

export default function KnowledgeBaseSourcesPage() {
  const { id } = useParams<{ id: string }>();
  const [sources, setSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [viewTarget, setViewTarget] = useState<DataSource | null>(null);
  const [editTarget, setEditTarget] = useState<DataSource | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm, setEditForm] = useState({
    seedUrls: '',
    crawlDepth: '0',
    includePatterns: '',
    excludePatterns: '',
    syncSchedule: 'manual',
  });

  const loadSources = useCallback(() => {
    setLoading(true);
    fetch(`/api/knowledge-bases/${id}/sources?limit=50`)
      .then((res) => res.json())
      .then((data) => {
        setSources(data.items ?? []);
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load sources');
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    loadSources();
  }, [id, loadSources]);

  const handleSync = async (sourceId: string) => {
    try {
      const res = await fetch(`/api/knowledge-bases/${id}/sources/${sourceId}/sync`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Sync failed');
      toast.success('Sync queued');
    } catch {
      toast.error('Failed to queue sync');
    }
  };

  const handleDelete = async (sourceId: string) => {
    try {
      const res = await fetch(`/api/knowledge-bases/${id}/sources/${sourceId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Delete failed');
      setSources((prev) => prev.filter((s) => s.id !== sourceId));
      toast.success('Source deleted');
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete source');
    }
  };

  const openView = async (sourceId: string) => {
    try {
      const res = await fetch(`/api/knowledge-bases/${id}/sources/${sourceId}`);
      if (!res.ok) throw new Error('Failed to load source');
      const data = await res.json();
      setViewTarget(data);
    } catch {
      toast.error('Failed to load source details');
    }
  };

  const openEdit = async (sourceId: string) => {
    try {
      setEditLoading(true);
      const res = await fetch(`/api/knowledge-bases/${id}/sources/${sourceId}`);
      if (!res.ok) throw new Error('Failed to load source');
      const data = await res.json();
      setEditTarget(data);
      const cfg = data.config ?? {};
      setEditForm({
        seedUrls: Array.isArray(cfg.urls) ? cfg.urls.join('\n') : '',
        crawlDepth: String(cfg.crawlDepth ?? '0'),
        includePatterns: Array.isArray(cfg.includePatterns) ? cfg.includePatterns.join('\n') : '',
        excludePatterns: Array.isArray(cfg.excludePatterns) ? cfg.excludePatterns.join('\n') : '',
        syncSchedule: data.syncSchedule ?? 'manual',
      });
    } catch {
      toast.error('Failed to load source details');
    } finally {
      setEditLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!editTarget) return;
    try {
      setEditLoading(true);
      const body: Record<string, unknown> = { config: {} };

      if (editTarget.type === 'URL') {
        const seedUrlsArray = editForm.seedUrls
          .split('\n')
          .map((u) => u.trim())
          .filter((u) => u.length > 0);
        const includeArray = editForm.includePatterns
          .split('\n')
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
        const excludeArray = editForm.excludePatterns
          .split('\n')
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        body.config = {
          urls: seedUrlsArray,
          crawlDepth: Number(editForm.crawlDepth),
          ...(includeArray.length > 0 ? { includePatterns: includeArray } : {}),
          ...(excludeArray.length > 0 ? { excludePatterns: excludeArray } : {}),
        };
      }

      if (editForm.syncSchedule && editForm.syncSchedule !== 'manual') {
        body.syncSchedule = editForm.syncSchedule;
      } else {
        body.syncSchedule = null;
      }

      const res = await fetch(`/api/knowledge-bases/${id}/sources/${editTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Update failed');
      toast.success('Source updated');
      setEditTarget(null);
      loadSources();
    } catch {
      toast.error('Failed to update source');
    } finally {
      setEditLoading(false);
    }
  };

  const columns: ColumnDef<DataSource>[] = [
    {
      accessorKey: 'type',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
      cell: ({ row }) => {
        const type = row.original.type;
        const cfg = TYPE_BADGES[type];
        const Icon = cfg.icon;
        return (
          <Badge variant={cfg.variant}>
            <Icon className="h-3 w-3 mr-1" />
            {cfg.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => (
        <Badge variant={STATUS_BADGES[row.original.status] ?? 'outline'}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: 'lastSyncAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Last Sync" />,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{formatDate(row.original.lastSyncAt)}</span>
      ),
    },
    {
      accessorKey: 'syncSchedule',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Schedule" />,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatScheduleLabel(row.original.syncSchedule)}
        </span>
      ),
    },
    {
      accessorKey: 'errorMessage',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Error" />,
      cell: ({ row }) => {
        const msg = row.original.errorMessage;
        if (!msg) return <span className="text-muted-foreground">—</span>;
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <div className="flex items-center gap-1 text-destructive max-w-[200px] truncate cursor-help">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="truncate text-xs">{msg}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">{msg}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          {row.original.type === 'URL' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => handleSync(row.original.id)}
              aria-label="Sync now"
            >
              <Play className="h-4 w-4" />
            </Button>
          )}
          {row.original.type === 'FILE' && (
            <Link
              href={`/knowledge-bases/${id}/upload?source=${row.original.id}`}
              className={buttonVariants({ variant: 'ghost', size: 'icon' }) + ' h-8 w-8'}
              aria-label="Upload files"
            >
              <Upload className="h-4 w-4" />
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => openView(row.original.id)}
            aria-label="View source"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => openEdit(row.original.id)}
            aria-label="Edit source"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive"
            onClick={() => setDeleteTarget(row.original.id)}
            aria-label="Delete source"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href={`/knowledge-bases/${id}`}
            aria-label="Back"
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Link2 className="h-5 w-5" />
          <h2 className="text-2xl font-bold tracking-tight">Sources</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={loadSources} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Link href={`/knowledge-bases/${id}/sources/new`} className={buttonVariants()}>
            <Plus className="h-4 w-4 mr-2" />
            Add Source
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Data Sources</CardTitle>
          <CardDescription>
            {loading ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              `${sources.length} source${sources.length !== 1 ? 's' : ''}`
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={sources}
              loading={false}
              enablePagination
              enableSorting
              enableFiltering={false}
              defaultPageSize={25}
              emptyMessage="No sources yet. Add a data source to get started."
            />
          )}
        </CardContent>
      </Card>
    <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete source?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the data source and all its documents. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setDeleteTarget(null)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => deleteTarget && handleDelete(deleteTarget)}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Dialog open={!!viewTarget} onOpenChange={(open) => !open && setViewTarget(null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Source Details</DialogTitle>
          <DialogDescription>View the configuration and status of this data source.</DialogDescription>
        </DialogHeader>
        {viewTarget && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Type</span>
              <Badge variant={TYPE_BADGES[viewTarget.type].variant}>
                {TYPE_BADGES[viewTarget.type].label}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={STATUS_BADGES[viewTarget.status] ?? 'outline'}>
                {viewTarget.status}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Schedule</span>
              <p>{formatScheduleLabel(viewTarget.syncSchedule)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Last Sync</span>
              <p>{formatDate(viewTarget.lastSyncAt)}</p>
            </div>
            {viewTarget.errorMessage && (
              <div>
                <span className="text-muted-foreground">Error</span>
                <p className="text-destructive">{viewTarget.errorMessage}</p>
              </div>
            )}
            {viewTarget.type === 'URL' && (
              <div className="space-y-2">
                <div>
                  <span className="text-muted-foreground">Seed URLs</span>
                  <div className="mt-1 rounded-md border bg-muted/50 p-2 space-y-1">
                    {Array.isArray(viewTarget.config?.urls) ? (
                      viewTarget.config.urls.map((url, i) => (
                        <p key={i} className="break-all">{String(url)}</p>
                      ))
                    ) : (
                      <p>—</p>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Crawl Depth</span>
                  <p>{typeof viewTarget.config?.crawlDepth === 'number' ? viewTarget.config.crawlDepth : '—'}</p>
                </div>
                {Array.isArray(viewTarget.config?.includePatterns) && viewTarget.config.includePatterns.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">Include Patterns</span>
                    <p>{viewTarget.config.includePatterns.map(String).join(', ')}</p>
                  </div>
                )}
                {Array.isArray(viewTarget.config?.excludePatterns) && viewTarget.config.excludePatterns.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">Exclude Patterns</span>
                    <p>{viewTarget.config.excludePatterns.map(String).join(', ')}</p>
                  </div>
                )}
              </div>
            )}
            {viewTarget.type !== 'URL' && (
              <div>
                <span className="text-muted-foreground">Config</span>
                <pre className="mt-1 rounded-md border bg-muted/50 p-2 text-xs overflow-auto">
                  {JSON.stringify(viewTarget.config, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setViewTarget(null)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={!!editTarget} onOpenChange={(open) => !open && !editLoading && setEditTarget(null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Source</DialogTitle>
          <DialogDescription>Update the data source configuration.</DialogDescription>
        </DialogHeader>
        {editTarget && (
          <div className="space-y-4">
            <div>
              <Label>Source Type</Label>
              <Badge variant={TYPE_BADGES[editTarget.type].variant} className="mt-1">
                {TYPE_BADGES[editTarget.type].label}
              </Badge>
            </div>

            {editTarget.type === 'URL' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="seedUrls">Seed URLs</Label>
                  <Textarea
                    id="seedUrls"
                    rows={4}
                    value={editForm.seedUrls}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, seedUrls: e.target.value }))}
                    placeholder="One URL per line"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="crawlDepth">Crawl Depth</Label>
                  <Select
                    value={editForm.crawlDepth}
                    onValueChange={(v) => setEditForm((prev) => ({ ...prev, crawlDepth: v }))}
                  >
                    <SelectTrigger id="crawlDepth">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 (Seed URLs only)</SelectItem>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="2">2</SelectItem>
                      <SelectItem value="3">3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="includePatterns">Include Patterns</Label>
                  <Textarea
                    id="includePatterns"
                    rows={3}
                    value={editForm.includePatterns}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, includePatterns: e.target.value }))}
                    placeholder="One pattern per line (optional)"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="excludePatterns">Exclude Patterns</Label>
                  <Textarea
                    id="excludePatterns"
                    rows={3}
                    value={editForm.excludePatterns}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, excludePatterns: e.target.value }))}
                    placeholder="One pattern per line (optional)"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="syncSchedule">Sync Schedule</Label>
              <Select
                value={editForm.syncSchedule}
                onValueChange={(v) => setEditForm((prev) => ({ ...prev, syncSchedule: v }))}
              >
                <SelectTrigger id="syncSchedule">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="0 * * * *">Hourly</SelectItem>
                  <SelectItem value="0 2 * * *">Daily</SelectItem>
                  <SelectItem value="0 2 * * 0">Weekly</SelectItem>
                  <SelectItem value="0 2 1 * *">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditTarget(null)} disabled={editLoading}>
            Cancel
          </Button>
          <Button onClick={handleUpdate} disabled={editLoading}>
            {editLoading ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import { Activity, ArrowLeft, RefreshCw, Search, CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { formatTimestamp, useTenantTimezone } from '@/lib/date-utils';

interface AuditLogRecord {
  id: string;
  tenantId: string;
  eventType: string;
  action: string;
  userId: string | null;
  resource: string | null;
  status: string;
  severity: string;
  metadata: any;
  createdAt: string;
}

interface AuditLogStats {
  totalLogs: number;
  successCount: number;
  errorCount: number;
  warningCount: number;
  systemEvents: number;
  userEvents: number;
  criticalEvents: number;
  byEventType: Record<string, number>;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  byResourceType: Record<string, number>;
}

interface AuditResponse {
  items: AuditLogRecord[];
  total: number;
  limit: number;
  offset: number;
  stats: AuditLogStats;
}

const SEVERITY_OPTIONS = ['all', 'low', 'medium', 'high', 'critical', 'info'];
const STATUS_OPTIONS = ['all', 'success', 'error', 'warning', 'info', 'pending'];
const PAGE_SIZE = 25;

export default function AuditPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const timezone = useTenantTimezone();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      if (eventTypeFilter !== 'all') params.set('eventType', eventTypeFilter);
      if (severityFilter !== 'all') params.set('severity', severityFilter);
      if (startDate) params.set('startDate', format(startDate, 'yyyy-MM-dd'));
      if (endDate) params.set('endDate', format(endDate, 'yyyy-MM-dd'));

      const res = await fetch(`/api/audit?${params.toString()}`);
      if (!res.ok) {
        toast.error('Failed to load audit logs');
        return;
      }
      const json = await res.json();
      setData(json);
    } catch {
      toast.error('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [offset, eventTypeFilter, severityFilter, startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePrev = () => setOffset((o) => Math.max(0, o - PAGE_SIZE));
  const handleNext = () => {
    if (data && offset + PAGE_SIZE < data.total) {
      setOffset((o) => o + PAGE_SIZE);
    }
  };

  const filteredItems = useMemo(() => {
    return data?.items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const haystack = [
          item.eventType,
          item.action,
          item.userId ?? '',
          item.resource ?? '',
          item.status,
          item.severity,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    }) ?? [];
  }, [data, statusFilter, searchTerm]);

  const stats = data?.stats;
  const eventTypes = stats ? Object.keys(stats.byEventType) : [];

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <Badge variant="destructive">{severity}</Badge>;
      case 'high':
        return <Badge className="bg-orange-500 text-white">{severity}</Badge>;
      case 'medium':
        return <Badge variant="secondary">{severity}</Badge>;
      case 'low':
        return <Badge variant="outline">{severity}</Badge>;
      default:
        return <Badge variant="outline">{severity}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return <Badge className="bg-green-600 text-white">success</Badge>;
      case 'error':
        return <Badge variant="destructive">error</Badge>;
      case 'warning':
        return <Badge className="bg-yellow-500 text-white">warning</Badge>;
      case 'pending':
        return <Badge variant="secondary">pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatTimestampLocal = (dateStr: string) => {
    if (!dateStr) return '—';
    return formatTimestamp(dateStr, timezone);
  };

  const columns: ColumnDef<AuditLogRecord>[] = useMemo(
    () => [
      {
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Timestamp" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground whitespace-nowrap text-xs">
            {formatTimestampLocal(row.original.createdAt)}
          </span>
        ),
      },
      {
        accessorKey: 'eventType',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Event" />,
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-sm">{row.original.eventType}</div>
            <div className="text-xs text-muted-foreground">{row.original.action}</div>
          </div>
        ),
      },
      {
        accessorKey: 'userId',
        header: ({ column }) => <DataTableColumnHeader column={column} title="User" />,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.userId ?? 'system'}</span>
        ),
      },
      {
        accessorKey: 'resource',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Resource" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.resource ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => getStatusBadge(row.original.status),
      },
      {
        accessorKey: 'severity',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Severity" />,
        cell: ({ row }) => getSeverityBadge(row.original.severity),
      },
    ],
    []
  );

  const header = (
    <div className="flex flex-wrap gap-3 items-end">
      <div className="space-y-1">
        <label className="text-xs font-medium">Event Type</label>
        <Select value={eventTypeFilter} onValueChange={(v) => { setEventTypeFilter(v); setOffset(0); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {eventTypes.map((et) => (
              <SelectItem key={et} value={et}>{et}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium">Severity</label>
        <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); setOffset(0); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All severities" />
          </SelectTrigger>
          <SelectContent>
            {SEVERITY_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{s === 'all' ? 'All severities' : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium">Status</label>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setOffset(0); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{s === 'all' ? 'All statuses' : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium">Start Date</label>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                className="w-40 justify-start text-left font-normal"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {startDate ? format(startDate, 'PPP') : 'Pick a date'}
              </Button>
            }
          />
          <PopoverContent className="w-auto p-0">
            <Calendar
              mode="single"
              selected={startDate}
              onSelect={(d) => {
                setStartDate(d);
                setOffset(0);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium">End Date</label>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                className="w-40 justify-start text-left font-normal"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {endDate ? format(endDate, 'PPP') : 'Pick a date'}
              </Button>
            }
          />
          <PopoverContent className="w-auto p-0">
            <Calendar
              mode="single"
              selected={endDate}
              onSelect={(d) => {
                setEndDate(d);
                setOffset(0);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-1 flex-1 min-w-[200px]">
        <label className="text-xs font-medium">Search</label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search events, users, resources..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <Button variant="outline" size="sm" onClick={fetchData}>
        <RefreshCw className="mr-2 h-4 w-4" />
        Refresh
      </Button>
    </div>
  );

  const footer = (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        {data ? `Showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, data.total)} of ${data.total}` : ''}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handlePrev} disabled={offset === 0 || loading}>
          Previous
        </Button>
        <Button variant="outline" size="sm" onClick={handleNext} disabled={!data || offset + PAGE_SIZE >= data.total || loading}>
          Next
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Activity className="h-6 w-6" />
          <h2 className="text-3xl font-bold tracking-tight">Audit Logs</h2>
        </div>
        <Link href="/settings">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Settings
          </Button>
        </Link>
      </div>
      <p className="text-muted-foreground">Review platform activity, user actions, and system events.</p>

      {/* Stats Cards */}
      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : stats ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Events</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalLogs}</div>
              <p className="text-xs text-muted-foreground">In selected period</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Successful</CardTitle>
              <Badge className="bg-green-600 text-white">ok</Badge>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.successCount}</div>
              <p className="text-xs text-muted-foreground">Success actions</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Warnings</CardTitle>
              <Badge className="bg-yellow-500 text-white">warn</Badge>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.warningCount}</div>
              <p className="text-xs text-muted-foreground">Warning events</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Errors</CardTitle>
              <Badge variant="destructive">err</Badge>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.errorCount}</div>
              <p className="text-xs text-muted-foreground">Failed actions</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Events</CardTitle>
          <CardDescription>
            {data ? `${data.total} total events` : 'Loading...'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={filteredItems}
              loading={loading}
              enablePagination={false}
              enableSorting
              enableFiltering={false}
              emptyMessage="No audit events match your filters."
              header={header}
              footer={footer}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

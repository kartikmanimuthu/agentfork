'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronLeft, ChevronRight, Search, Star } from 'lucide-react';

const SENTIMENT_COLORS: Record<string, string> = {
  POSITIVE: '#10B981',
  NEGATIVE: '#EF4444',
  NEUTRAL: '#6366F1',
  MIXED: '#F59E0B',
};

interface Filters {
  fromDate: string;
  toDate: string;
  search: string;
  sentiment: string;
  resolvedStatus: string;
  status: string;
  page: number;
}

export default function AnalyticsSessionsPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>({
    fromDate: '', toDate: '', search: '', sentiment: 'all', resolvedStatus: 'all', status: 'all', page: 1,
  });
  const [appliedFilters, setAppliedFilters] = useState<Filters>(filters);

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-sessions', appliedFilters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (appliedFilters.fromDate) params.append('fromDate', appliedFilters.fromDate);
      if (appliedFilters.toDate) params.append('toDate', appliedFilters.toDate);
      if (appliedFilters.search) params.append('search', appliedFilters.search);
      if (appliedFilters.sentiment !== 'all') params.append('sentiment', appliedFilters.sentiment);
      if (appliedFilters.resolvedStatus !== 'all') params.append('resolvedStatus', appliedFilters.resolvedStatus);
      if (appliedFilters.status !== 'all') params.append('status', appliedFilters.status);
      params.append('page', String(appliedFilters.page));
      params.append('limit', '20');
      const res = await fetch(`/api/analytics/sessions?${params}`);
      if (!res.ok) throw new Error('Failed to fetch sessions');
      return res.json();
    },
    staleTime: 1000 * 60 * 2,
  });

  const handleApply = () => setAppliedFilters({ ...filters, page: 1 });
  const handleClear = () => {
    const cleared: Filters = { fromDate: '', toDate: '', search: '', sentiment: 'all', resolvedStatus: 'all', status: 'all', page: 1 };
    setFilters(cleared);
    setAppliedFilters(cleared);
  };
  const setPage = (p: number) => {
    const updated = { ...appliedFilters, page: p };
    setAppliedFilters(updated);
    setFilters(updated);
  };

  const sessions = data?.sessions || [];
  const pagination = data?.pagination || { page: 1, totalPages: 1, total: 0 };

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-3xl font-bold tracking-tight">Sessions</h1>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-medium text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by ID or title..."
                  value={filters.search}
                  onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input type="date" value={filters.fromDate} onChange={(e) => setFilters(f => ({ ...f, fromDate: e.target.value }))} className="w-36" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input type="date" value={filters.toDate} onChange={(e) => setFilters(f => ({ ...f, toDate: e.target.value }))} className="w-36" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Sentiment</label>
              <Select value={filters.sentiment} onValueChange={(v) => setFilters(f => ({ ...f, sentiment: v }))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="POSITIVE">Positive</SelectItem>
                  <SelectItem value="NEGATIVE">Negative</SelectItem>
                  <SelectItem value="NEUTRAL">Neutral</SelectItem>
                  <SelectItem value="MIXED">Mixed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Resolution</label>
              <Select value={filters.resolvedStatus} onValueChange={(v) => setFilters(f => ({ ...f, resolvedStatus: v }))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="unresolved">Unresolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleApply} size="sm">Apply</Button>
            <Button onClick={handleClear} variant="outline" size="sm">Clear</Button>
          </div>
        </CardContent>
      </Card>

      {/* Status Tabs */}
      <Tabs value={appliedFilters.status} onValueChange={(v) => {
        const updated = { ...filters, status: v, page: 1 };
        setFilters(updated);
        setAppliedFilters(updated);
      }}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Sessions List */}
      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="py-4"><Skeleton className="h-12 w-full" /></CardContent>
            </Card>
          ))
        ) : sessions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No sessions found. Try adjusting your filters.
            </CardContent>
          </Card>
        ) : (
          sessions.map((session: any) => (
            <Card
              key={session.id}
              className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => router.push(`/analytics/sessions/${session.id}`)}
            >
              <CardContent className="py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium truncate">
                        {session.firstUserQuery || session.title || 'Untitled conversation'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{session.id.slice(0, 8)}...</span>
                      <span>{new Date(session.createdAt).toLocaleDateString()}</span>
                      <span>{session.messageCount} msgs</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={session.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                      {session.status}
                    </Badge>
                    {session.sentiment && (
                      <Badge variant="outline" className="text-xs" style={{
                        borderColor: SENTIMENT_COLORS[session.sentiment],
                        color: SENTIMENT_COLORS[session.sentiment],
                      }}>
                        {session.sentiment}
                      </Badge>
                    )}
                    {session.isResolved !== null && (
                      <Badge variant="outline" className="text-xs" style={{
                        borderColor: session.isResolved ? '#10B981' : '#EF4444',
                        color: session.isResolved ? '#10B981' : '#EF4444',
                      }}>
                        {session.isResolved ? 'Resolved' : 'Unresolved'}
                      </Badge>
                    )}
                    {session.feedbackRating && (
                      <div className="flex items-center gap-0.5">
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        <span className="text-xs">{session.feedbackRating}</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPage(pagination.page - 1)}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage(pagination.page + 1)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

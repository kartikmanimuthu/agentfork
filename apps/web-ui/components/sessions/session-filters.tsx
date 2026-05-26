'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Search, SlidersHorizontal } from 'lucide-react';

export interface SessionFiltersState {
  channel: string;
  status: string;
  sentiment: string;
  resolvedStatus: string;
  fromDate: string;
  toDate: string;
  search: string;
  page: number;
}

export const DEFAULT_FILTERS: SessionFiltersState = {
  channel: 'all',
  status: 'all',
  sentiment: 'all',
  resolvedStatus: 'all',
  fromDate: '',
  toDate: '',
  search: '',
  page: 1,
};

interface SessionFiltersProps {
  filters: SessionFiltersState;
  onChange: (filters: SessionFiltersState) => void;
  onApply: () => void;
  onClear: () => void;
}

export function SessionFilters({ filters, onChange, onApply, onClear }: SessionFiltersProps) {
  const [expanded, setExpanded] = useState(false);

  const update = (patch: Partial<SessionFiltersState>) => onChange({ ...filters, ...patch });

  const hasActiveFilters =
    filters.channel !== 'all' ||
    filters.sentiment !== 'all' ||
    filters.resolvedStatus !== 'all' ||
    filters.fromDate !== '' ||
    filters.toDate !== '';

  return (
    <div className="space-y-3">
      {/* Search + filter toggle */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by ID or name..."
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && onApply()}
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setExpanded(!expanded)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {hasActiveFilters && (
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          )}
        </Button>
      </div>

      {/* Expandable filter row */}
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleContent>
          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">From</label>
              <Input
                type="date"
                value={filters.fromDate}
                onChange={(e) => update({ fromDate: e.target.value })}
                className="w-36 h-8 text-xs"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">To</label>
              <Input
                type="date"
                value={filters.toDate}
                onChange={(e) => update({ toDate: e.target.value })}
                className="w-36 h-8 text-xs"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Channel</label>
              <Select value={filters.channel} onValueChange={(v) => update({ channel: v })}>
                <SelectTrigger className="w-28 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="API">API</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Sentiment</label>
              <Select value={filters.sentiment} onValueChange={(v) => update({ sentiment: v })}>
                <SelectTrigger className="w-28 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
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
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Resolution</label>
              <Select value={filters.resolvedStatus} onValueChange={(v) => update({ resolvedStatus: v })}>
                <SelectTrigger className="w-28 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="unresolved">Unresolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 ml-auto">
              <Button onClick={onApply} size="sm" className="h-8 text-xs">Apply</Button>
              <Button onClick={onClear} variant="ghost" size="sm" className="h-8 text-xs">Clear</Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

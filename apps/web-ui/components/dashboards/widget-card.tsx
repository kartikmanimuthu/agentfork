'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { WidgetRenderer } from './widget-renderer';
import { useWidgetData } from './use-widget-data';
import type { WidgetDTO } from '@/lib/dashboards/types';

export function WidgetCard({ widget, editable, onDelete }: { widget: WidgetDTO; editable: boolean; onDelete: (id: string) => void }) {
  const { data, isLoading, error } = useWidgetData(widget.querySpec);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
        <CardTitle className="text-sm font-medium">{widget.title}</CardTitle>
        {editable && (
          <Button variant="ghost" size="icon" className="h-6 w-6 no-drag" onClick={() => onDelete(widget.id)}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 pb-3">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-sm text-destructive">Failed to load</div>
        ) : (
          <WidgetRenderer vizType={widget.vizType} data={data?.rows ?? []} />
        )}
      </CardContent>
    </Card>
  );
}

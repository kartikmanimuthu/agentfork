'use client';

import { useState, useRef } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import type { LayoutItem } from 'react-grid-layout';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { WidgetCard } from './widget-card';
import type { DashboardDTO, WidgetDTO } from '@/lib/dashboards/types';

const ResponsiveGrid = WidthProvider(Responsive);

export function DashboardGrid({ dashboard, editable }: { dashboard: DashboardDTO; editable: boolean }) {
  const qc = useQueryClient();
  const [widgets, setWidgets] = useState<WidgetDTO[]>(dashboard.widgets);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const saveLayout = useMutation({
    mutationFn: async (layouts: { id: string; layout: WidgetDTO['layout'] }[]) => {
      const res = await fetch(`/api/dashboards/${dashboard.id}/layout`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ layouts }),
      });
      if (!res.ok) throw new Error('Failed to save layout');
    },
  });

  const deleteWidget = useMutation({
    mutationFn: async (widgetId: string) => {
      const res = await fetch(`/api/dashboards/${dashboard.id}/widgets/${widgetId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete widget');
    },
    onSuccess: (_d, widgetId) => {
      setWidgets((w) => w.filter((x) => x.id !== widgetId));
      qc.invalidateQueries({ queryKey: ['dashboard', dashboard.id] });
    },
  });

  const layout: LayoutItem[] = widgets.map((w) => ({ i: w.id, ...w.layout }));

  function onLayoutChange(next: readonly LayoutItem[]) {
    if (!editable) return;
    const updated = widgets.map((w) => {
      const l = next.find((n) => n.i === w.id);
      return l ? { ...w, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : w;
    });
    setWidgets(updated);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveLayout.mutate(updated.map((w) => ({ id: w.id, layout: w.layout })));
    }, 600);
  }

  return (
    <ResponsiveGrid
      className="layout"
      layouts={{ lg: layout }}
      breakpoints={{ lg: 996, md: 768, sm: 0 }}
      cols={{ lg: 12, md: 8, sm: 4 }}
      rowHeight={60}
      isDraggable={editable}
      isResizable={editable}
      draggableCancel=".no-drag"
      onLayoutChange={onLayoutChange}
    >
      {widgets.map((w) => (
        <div key={w.id}>
          <WidgetCard widget={w} editable={editable} onDelete={(id) => deleteWidget.mutate(id)} />
        </div>
      ))}
    </ResponsiveGrid>
  );
}

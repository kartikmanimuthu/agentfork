'use client';

import { use, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, Check } from 'lucide-react';
import { DashboardGrid } from '@/components/dashboards/dashboard-grid';
import { WidgetBuilder } from '@/components/dashboards/widget-builder';
import type { DashboardDTO } from '@/lib/dashboards/types';
import '../dashboards.css';

export default function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', id],
    queryFn: async (): Promise<{ dashboard: DashboardDTO }> => {
      const res = await fetch(`/api/dashboards/${id}`);
      if (!res.ok) throw new Error('Failed to load dashboard');
      return res.json();
    },
  });

  const addWidget = useMutation({
    mutationFn: async (input: unknown) => {
      const res = await fetch(`/api/dashboards/${id}/widgets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to add widget');
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', id] }),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!data?.dashboard) return <div className="p-6 text-sm text-destructive">Dashboard not found</div>;

  const dashboard = data.dashboard;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{dashboard.name}</h1>
        <div className="flex gap-2">
          {editing && <Button variant="outline" onClick={() => setBuilderOpen(true)}><Plus className="mr-1 h-4 w-4" /> Add widget</Button>}
          <Button variant={editing ? 'default' : 'outline'} onClick={() => setEditing((e) => !e)}>
            {editing ? <><Check className="mr-1 h-4 w-4" /> Done</> : <><Pencil className="mr-1 h-4 w-4" /> Edit</>}
          </Button>
        </div>
      </div>

      {dashboard.widgets.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          <p>No widgets yet.</p>
          <Button className="mt-3" onClick={() => { setEditing(true); setBuilderOpen(true); }}><Plus className="mr-1 h-4 w-4" /> Add your first widget</Button>
        </div>
      ) : (
        <DashboardGrid key={dashboard.widgets.length} dashboard={dashboard} editable={editing} />
      )}

      <WidgetBuilder open={builderOpen} onOpenChange={setBuilderOpen} onSave={(input) => addWidget.mutate(input)} />
    </div>
  );
}

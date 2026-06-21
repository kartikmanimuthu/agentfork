'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus, LayoutDashboard } from 'lucide-react';
import type { DashboardListItem } from '@/lib/dashboards/types';

export default function DashboardsListPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['dashboards'],
    queryFn: async (): Promise<{ dashboards: DashboardListItem[] }> => {
      const res = await fetch('/api/dashboards');
      if (!res.ok) throw new Error('Failed to load dashboards');
      return res.json();
    },
  });

  const create = useMutation({
    mutationFn: async (payload: { name: string }) => {
      const res = await fetch('/api/dashboards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('Failed to create dashboard');
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dashboards'] }); setOpen(false); setName(''); },
  });

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboards</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button><Plus className="mr-1 h-4 w-4" /> New dashboard</Button>} />
          <DialogContent>
            <DialogHeader><DialogTitle>Create dashboard</DialogTitle></DialogHeader>
            <div className="space-y-1.5 py-2">
              <Label htmlFor="dash-name">Name</Label>
              <Input id="dash-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support overview" maxLength={100} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate({ name: name.trim() })}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (data?.dashboards.length ?? 0) === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          <LayoutDashboard className="mb-2 h-8 w-8" />
          <p>No dashboards yet. Create your first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data!.dashboards.map((d) => (
            <Link key={d.id} href={`/dashboards/${d.id}`}>
              <Card className="transition-colors hover:border-primary">
                <CardHeader>
                  <CardTitle className="text-base">{d.name}</CardTitle>
                  {d.description && <CardDescription>{d.description}</CardDescription>}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

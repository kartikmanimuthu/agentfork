'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Plus, Database } from 'lucide-react';

interface DatasetRow { id: string; name: string; description: string | null; _count?: { items: number }; createdAt: string; }

export default function DatasetsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ datasets: DatasetRow[] }>({
    queryKey: ['eval-datasets'],
    queryFn: async () => (await fetch('/api/evaluation/datasets')).json(),
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/evaluation/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description: description || undefined }) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      return res.json();
    },
    onSuccess: () => { setOpen(false); setName(''); setDescription(''); setError(null); qc.invalidateQueries({ queryKey: ['eval-datasets'] }); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold">Datasets</h1><p className="text-sm text-muted-foreground">Curated collections of evaluation items.</p></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button><Plus className="size-4 mr-1" /> New dataset</Button>} />
          <DialogContent>
            <DialogHeader><DialogTitle>New dataset</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending || !name}>Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(data?.datasets ?? []).map((d) => (
            <Card key={d.id} className="cursor-pointer hover:border-primary" onClick={() => router.push(`/evaluation/datasets/${d.id}`)}>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Database className="size-4" /> {d.name}</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-muted-foreground line-clamp-2">{d.description}</p><p className="text-xs mt-2">{d._count?.items ?? 0} items</p></CardContent>
            </Card>
          ))}
          {(data?.datasets ?? []).length === 0 && <p className="text-sm text-muted-foreground">No datasets yet.</p>}
        </div>
      )}
    </div>
  );
}

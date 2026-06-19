'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { DatabaseZap } from 'lucide-react';

interface Dataset {
  id: string;
  name: string;
  _count?: { items: number };
}

export function AddToDatasetDrawer({
  targetType,
  targetId,
  label,
}: {
  targetType: 'SESSION' | 'EXECUTION';
  targetId: string;
  label?: string;
}) {
  const qc = useQueryClient();
  const { data: dsData } = useQuery<{ datasets: Dataset[] }>({
    queryKey: ['eval-datasets'],
    queryFn: async () => (await fetch('/api/evaluation/datasets')).json(),
  });
  const [datasetId, setDatasetId] = useState('');

  const datasets = dsData?.datasets ?? [];

  const addToDataset = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/evaluation/datasets/${datasetId}/items/from-trace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
    },
    onSuccess: () => {
      toast.success('Added to dataset');
      qc.invalidateQueries({ queryKey: ['eval-datasets'] });
      qc.invalidateQueries({ queryKey: ['eval-dataset-items', datasetId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm">
            <DatabaseZap className="size-4 mr-1" /> Add to dataset
          </Button>
        }
      />
      <SheetContent className="w-[420px] sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>Add {label ?? targetType.toLowerCase()} to a dataset</SheetTitle>
          <SheetDescription>
            Capture this {targetType.toLowerCase()}&apos;s input and output as a reusable evaluation item.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 mt-4 px-4">
          {datasets.length === 0 ? (
            <Empty className="border rounded-md py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <DatabaseZap />
                </EmptyMedia>
                <EmptyTitle>No datasets</EmptyTitle>
                <EmptyDescription>Create a dataset under Evaluation → Datasets first.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Dataset</Label>
                <Select value={datasetId} onValueChange={setDatasetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a dataset" />
                  </SelectTrigger>
                  <SelectContent>
                    {datasets.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name} ({d._count?.items ?? 0})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => addToDataset.mutate()}
                disabled={!datasetId || addToDataset.isPending}
                className="w-full"
              >
                Add to dataset
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

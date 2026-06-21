'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft } from 'lucide-react';

interface DatasetItem {
  id: string;
  input: unknown;
  expectedOutput: unknown;
  status: string;
  createdAt: string;
}

function pretty(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export default function DatasetItemDetailPage() {
  const { id, itemId } = useParams<{ id: string; itemId: string }>();
  const router = useRouter();

  const { data, isLoading } = useQuery<{ items: DatasetItem[] }>({
    queryKey: ['eval-dataset-items', id],
    queryFn: async () => (await fetch(`/api/evaluation/datasets/${id}/items`)).json(),
  });

  const item = (data?.items ?? []).find((it) => it.id === itemId);

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <Button variant="ghost" size="sm" className="w-fit" onClick={() => router.push(`/evaluation/datasets/${id}`)}>
        <ChevronLeft className="size-4 mr-1" /> Back to dataset
      </Button>

      <div className="flex items-center gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Dataset item</h2>
        {item && <Badge variant="outline">{item.status}</Badge>}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !item ? (
        <p className="text-sm text-muted-foreground">Item not found.</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Input</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-4 font-mono text-xs">
                {pretty(item.input)}
              </pre>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Expected output</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-4 font-mono text-xs">
                {pretty(item.expectedOutput)}
              </pre>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

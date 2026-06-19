'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronLeft, Pencil } from 'lucide-react';
import { ScoreConfigDialog, type ScoreConfigForDialog } from '@/components/evaluation/score-config-dialog';

interface ScoreConfig extends ScoreConfigForDialog {
  isArchived: boolean;
  createdAt: string;
}
interface ScoreRow {
  id: string;
  targetType: string;
  numericValue: number | null;
  stringValue: string | null;
  source: string;
  comment: string | null;
  createdAt: string;
}

export default function ScoreConfigDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading } = useQuery<{ config: ScoreConfig }>({
    queryKey: ['eval-score-config', id],
    queryFn: async () => (await fetch(`/api/evaluation/score-configs/${id}`)).json(),
  });
  const { data: scoresData } = useQuery<{ scores: ScoreRow[] }>({
    queryKey: ['eval-scores', 'by-config', id],
    queryFn: async () => (await fetch(`/api/evaluation/scores?configId=${encodeURIComponent(id)}`)).json(),
  });

  const config = data?.config;
  const scores = scoresData?.scores ?? [];

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <Button variant="ghost" size="sm" className="w-fit" onClick={() => router.push('/evaluation/scores')}>
        <ChevronLeft className="size-4 mr-1" /> Scores
      </Button>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-3xl font-bold tracking-tight">{isLoading ? 'Loading…' : config?.name}</h2>
            {config && <Badge variant="outline">{config.dataType}</Badge>}
            {config?.isArchived && <Badge variant="secondary">Archived</Badge>}
          </div>
          <p className="text-muted-foreground">{config?.description ?? 'No description.'}</p>
        </div>
        {config && (
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Definition</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {config?.dataType === 'NUMERIC' && (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-32">Range</span>
              <span className="font-medium">
                {config.minValue ?? '−∞'} … {config.maxValue ?? '∞'}
              </span>
            </div>
          )}
          {config?.dataType === 'CATEGORICAL' && (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-32">Categories</span>
              <div className="flex flex-wrap gap-1">
                {(config.categories ?? []).map((c) => (
                  <Badge key={c.label} variant="outline">
                    {c.label} = {c.value}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {config?.dataType === 'BOOLEAN' && (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-32">Values</span>
              <span className="font-medium">true / false</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scores using this config ({scores.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {scores.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scores recorded with this config yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Value</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Comment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scores.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.stringValue ?? s.numericValue}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{s.targetType}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.source === 'API' ? 'secondary' : 'default'}>{s.source}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">{s.comment ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {config && (
        <ScoreConfigDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          config={config}
        />
      )}
    </div>
  );
}

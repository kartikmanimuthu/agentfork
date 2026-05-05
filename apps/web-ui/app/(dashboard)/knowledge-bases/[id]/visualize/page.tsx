'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { BarChart3, ArrowLeft, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';

interface UmapPoint {
  id: string;
  x: number;
  y: number;
  label?: string;
  metadata?: Record<string, unknown>;
}

interface UmapResult {
  points: UmapPoint[];
  computedAt: string;
  message?: string;
}

// Simple SVG scatter plot — no external chart dependency needed
function ScatterPlot({ points }: { points: UmapPoint[] }) {
  const [zoom, setZoom] = useState(1);
  const [hovered, setHovered] = useState<UmapPoint | null>(null);

  if (points.length === 0) return null;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const W = 600;
  const H = 400;
  const PAD = 24;

  const toSvg = (x: number, y: number) => ({
    cx: PAD + ((x - minX) / rangeX) * (W - 2 * PAD),
    cy: PAD + ((y - minY) / rangeY) * (H - 2 * PAD),
  });

  // Color by label (document name)
  const labels = Array.from(new Set(points.map((p) => p.label ?? 'unknown')));
  const COLORS = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
    '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#14b8a6',
  ];
  const colorMap = Object.fromEntries(labels.map((l, i) => [l, COLORS[i % COLORS.length]]));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {labels.slice(0, 8).map((label) => (
            <div key={label} className="flex items-center gap-1.5 text-xs">
              <div className="h-2.5 w-2.5 rounded-full" style={{ background: colorMap[label] }} />
              <span className="text-muted-foreground truncate max-w-[120px]">{label}</span>
            </div>
          ))}
          {labels.length > 8 && (
            <span className="text-xs text-muted-foreground">+{labels.length - 8} more</span>
          )}
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(z + 0.25, 3))}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}>
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border bg-muted/20">
        <svg
          width={W * zoom}
          height={H * zoom}
          viewBox={`0 0 ${W} ${H}`}
          className="block"
          aria-label="UMAP embedding projection scatter plot"
        >
          {points.map((p) => {
            const { cx, cy } = toSvg(p.x, p.y);
            const color = colorMap[p.label ?? 'unknown'] ?? '#6366f1';
            return (
              <circle
                key={p.id}
                cx={cx}
                cy={cy}
                r={hovered?.id === p.id ? 5 : 3}
                fill={color}
                fillOpacity={0.75}
                stroke={hovered?.id === p.id ? 'white' : 'none'}
                strokeWidth={1.5}
                className="cursor-pointer transition-all"
                onMouseEnter={() => setHovered(p)}
                onMouseLeave={() => setHovered(null)}
                aria-label={p.label}
              />
            );
          })}
        </svg>
      </div>

      {hovered && (
        <div className="rounded-md border bg-card p-3 text-sm space-y-1">
          <p className="font-medium">{hovered.label ?? 'Unknown document'}</p>
          {hovered.metadata?.content != null && (
            <p className="text-muted-foreground text-xs line-clamp-2">
              {String(hovered.metadata.content)}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            ({hovered.x.toFixed(3)}, {hovered.y.toFixed(3)})
          </p>
        </div>
      )}
    </div>
  );
}

export default function KnowledgeBaseVisualizePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<UmapResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(500);

  const load = (l = limit) => {
    setLoading(true);
    fetch(`/api/knowledge-bases/${id}/umap?limit=${l}`)
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load UMAP projection');
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, [id]);

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href={`/knowledge-bases/${id}`} aria-label="Back" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <BarChart3 className="h-5 w-5" />
          <h2 className="text-2xl font-bold tracking-tight">Embedding Visualization</h2>
        </div>
        <Button variant="outline" size="icon" onClick={() => load()} aria-label="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>UMAP Projection</CardTitle>
          <CardDescription>
            2D projection of chunk embeddings. Points close together are semantically similar.
            {data?.computedAt && (
              <span className="ml-2 text-xs">
                Computed {new Date(data.computedAt).toLocaleTimeString()}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-[400px] w-full" />
            </div>
          ) : data?.message ? (
            <div className="py-16 text-center text-muted-foreground">
              <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>{data.message}</p>
              <p className="text-sm mt-1">Upload and process documents to see the visualization.</p>
            </div>
          ) : data?.points && data.points.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{data.points.length} chunks</Badge>
                <div className="flex gap-1">
                  {[200, 500, 1000].map((n) => (
                    <Button
                      key={n}
                      variant={limit === n ? 'default' : 'outline'}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => { setLimit(n); load(n); }}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </div>
              <ScatterPlot points={data.points} />
            </div>
          ) : (
            <div className="py-16 text-center text-muted-foreground">
              No embeddings found. Process some documents first.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { FlaskConical, ArrowLeft, Search, ChevronDown, ChevronUp } from 'lucide-react';

interface RetrievalResult {
  chunkId: string;
  content: string;
  score: number;
  documentName: string;
  documentId: string;
  denseScore?: number;
  sparseScore?: number;
  rrfScore?: number;
  rerankScore?: number;
  compressionKept: boolean;
}

const testSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  topK: z.number().int().min(1, 'Top K must be at least 1').max(100, 'Top K must be at most 100'),
  searchMode: z.enum(['HYBRID', 'DENSE', 'SPARSE']),
  similarityThreshold: z.number().min(0).max(1),
  hybridAlpha: z.number().min(0).max(1),
  rerankProvider: z.enum(['NONE', 'COHERE', 'CROSS_ENCODER']),
});

type TestFormValues = z.infer<typeof testSchema>;

export default function KnowledgeBaseTestPage() {
  const { id } = useParams<{ id: string }>();
  const [results, setResults] = useState<RetrievalResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);

  const toggleExpand = (chunkId: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(chunkId) ? next.delete(chunkId) : next.add(chunkId);
      return next;
    });

  const form = useForm({
    defaultValues: {
      query: '',
      topK: 5,
      searchMode: 'HYBRID',
      similarityThreshold: 0.7,
      hybridAlpha: 0.7,
      rerankProvider: 'NONE',
    } as TestFormValues,
    validators: { onChange: testSchema },
    onSubmit: async ({ value }) => {
      setLoading(true);
      setResults([]);
      try {
        const res = await fetch(`/api/knowledge-bases/${id}/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Search failed');
        setResults(data.results ?? []);
        setConfig(data.config ?? null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setLoading(false);
      }
    },
  });

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6">
      <div className="flex items-center gap-2">
        <Link href={`/knowledge-bases/${id}`} aria-label="Back" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <FlaskConical className="h-5 w-5" />
        <h2 className="text-2xl font-bold tracking-tight">Test Retrieval</h2>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Config panel */}
          <Card className="lg:col-span-1 h-fit">
            <CardHeader>
              <CardTitle className="text-base">Search Parameters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form.Field name="topK">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Top K</Label>
                    <Input
                      id={field.name}
                      type="number"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : 0)}
                      onBlur={field.handleBlur}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.Field name="searchMode">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Search Mode</Label>
                    <Select value={field.state.value} onValueChange={(v) => field.handleChange(v as 'HYBRID' | 'DENSE' | 'SPARSE')}>
                      <SelectTrigger id={field.name}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HYBRID">Hybrid (RRF)</SelectItem>
                        <SelectItem value="DENSE">Dense (vector)</SelectItem>
                        <SelectItem value="SPARSE">Sparse (BM25)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </form.Field>

              <form.Subscribe selector={(state) => state.values.searchMode}>
                {(searchMode) => (
                  <>
                    {searchMode !== 'SPARSE' && (
                      <form.Field name="similarityThreshold">
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Similarity Threshold</Label>
                            <Input
                              id={field.name}
                              type="number"
                              step={0.05}
                              min={0}
                              max={1}
                              value={field.state.value}
                              onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : 0)}
                              onBlur={field.handleBlur}
                            />
                            {field.state.meta.errors.length > 0 && (
                              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                            )}
                          </div>
                        )}
                      </form.Field>
                    )}

                    {searchMode === 'HYBRID' && (
                      <form.Field name="hybridAlpha">
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Hybrid Alpha (dense weight)</Label>
                            <Input
                              id={field.name}
                              type="number"
                              step={0.1}
                              min={0}
                              max={1}
                              value={field.state.value}
                              onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : 0)}
                              onBlur={field.handleBlur}
                            />
                            {field.state.meta.errors.length > 0 && (
                              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                            )}
                          </div>
                        )}
                      </form.Field>
                    )}
                  </>
                )}
              </form.Subscribe>

              <form.Field name="rerankProvider">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Reranker</Label>
                    <Select value={field.state.value} onValueChange={(v) => field.handleChange(v as 'NONE' | 'COHERE' | 'CROSS_ENCODER')}>
                      <SelectTrigger id={field.name}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">None</SelectItem>
                        <SelectItem value="COHERE">Cohere</SelectItem>
                        <SelectItem value="CROSS_ENCODER">Cross-Encoder</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </form.Field>
            </CardContent>
          </Card>

          {/* Query + results */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex gap-2">
                  <form.Field name="query">
                    {(field) => (
                      <div className="flex-1 space-y-2">
                        <Input
                          placeholder="Enter a query to test retrieval..."
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          onBlur={field.handleBlur}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              form.handleSubmit();
                            }
                          }}
                          className="flex-1"
                        />
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                        )}
                      </div>
                    )}
                  </form.Field>
                  <Button type="submit" disabled={loading || !form.state.values.query.trim()}>
                    <Search className="h-4 w-4 mr-2" />
                    {loading ? 'Searching...' : 'Search'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {results.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{results.length} results</p>
                  {config && (
                    <div className="flex gap-1 flex-wrap justify-end">
                      {Object.entries(config).map(([k, v]) => (
                        <Badge key={k} variant="outline" className="text-xs">
                          {k}: {String(v)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {results.map((r, i) => (
                  <Card key={r.chunkId}>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="shrink-0">#{i + 1}</Badge>
                          <span className="text-sm font-medium truncate">{r.documentName}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge className="text-xs">{(r.score * 100).toFixed(1)}%</Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => toggleExpand(r.chunkId)}
                            aria-label={expandedIds.has(r.chunkId) ? 'Collapse' : 'Expand'}
                          >
                            {expandedIds.has(r.chunkId) ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>

                      <p className={`mt-2 text-sm text-muted-foreground ${expandedIds.has(r.chunkId) ? '' : 'line-clamp-3'}`}>
                        {r.content}
                      </p>

                      {expandedIds.has(r.chunkId) && (
                        <>
                          <Separator className="my-3" />
                          <div className="flex gap-3 flex-wrap text-xs text-muted-foreground">
                            {r.denseScore !== undefined && <span>Dense: {r.denseScore.toFixed(4)}</span>}
                            {r.sparseScore !== undefined && <span>Sparse: {r.sparseScore.toFixed(4)}</span>}
                            {r.rrfScore !== undefined && <span>RRF: {r.rrfScore.toFixed(4)}</span>}
                            {r.rerankScore !== undefined && <span>Rerank: {r.rerankScore.toFixed(4)}</span>}
                            <span>Chunk: {r.chunkId.slice(-8)}</span>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {!loading && results.length === 0 && form.state.values.query && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No results found. Try a different query or lower the similarity threshold.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

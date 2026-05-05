'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  Database, FileText, Settings, FlaskConical, BarChart3,
  ArrowLeft, RefreshCw, Layers
} from 'lucide-react';

interface KbStats {
  id: string;
  name: string;
  description: string | null;
  status: string;
  documentCount: number;
  chunkCount: number;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimensions: number;
  chunkStrategy: string;
  chunkSize: number;
  chunkOverlap: number;
  createdAt: string;
  updatedAt: string;
}

export default function KnowledgeBaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [kb, setKb] = useState<KbStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch(`/api/knowledge-bases/${id}/stats`)
      .then((res) => res.json())
      .then((data) => {
        setKb(data);
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load knowledge base');
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, [id]);

  const navItems = [
    { href: `/knowledge-bases/${id}/documents`, icon: FileText, label: 'Documents', desc: 'Manage uploaded documents' },
    { href: `/knowledge-bases/${id}/test`, icon: FlaskConical, label: 'Test Retrieval', desc: 'Query and tune search settings' },
    { href: `/knowledge-bases/${id}/visualize`, icon: BarChart3, label: 'Visualize', desc: 'UMAP embedding projection' },
    { href: `/knowledge-bases/${id}/settings`, icon: Settings, label: 'Settings', desc: 'Edit configuration' },
  ];

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/knowledge-bases" aria-label="Back" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Database className="h-6 w-6" />
          {loading ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <div>
              <h2 className="text-2xl font-bold tracking-tight">{kb?.name}</h2>
              {kb?.description && (
                <p className="text-sm text-muted-foreground">{kb.description}</p>
              )}
            </div>
          )}
        </div>
        <Button variant="outline" size="icon" onClick={load} aria-label="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Status', value: kb?.status, badge: true },
          { label: 'Documents', value: kb?.documentCount?.toString() ?? '—' },
          { label: 'Chunks', value: kb?.chunkCount?.toLocaleString() ?? '—' },
          { label: 'Embedding', value: kb?.embeddingProvider ?? '—' },
        ].map(({ label, value, badge }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              {loading ? (
                <Skeleton className="h-6 w-20 mt-1" />
              ) : badge ? (
                <Badge className="mt-1" variant={value === 'active' ? 'default' : 'secondary'}>
                  {value}
                </Badge>
              ) : (
                <p className="text-lg font-semibold mt-0.5">{value}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Config summary */}
      {!loading && kb && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              {[
                { label: 'Model', value: kb.embeddingModel },
                { label: 'Dimensions', value: String(kb.embeddingDimensions) },
                { label: 'Chunk Strategy', value: kb.chunkStrategy },
                { label: 'Chunk Size', value: `${kb.chunkSize} tokens` },
                { label: 'Chunk Overlap', value: `${kb.chunkOverlap} tokens` },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-muted-foreground text-xs">{label}</p>
                  <p className="font-medium">{value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {navItems.map(({ href, icon: Icon, label, desc }) => (
          <Card key={href} className="hover:bg-accent/30 transition-colors cursor-pointer">
            <Link href={href} className="block">
              <CardContent className="flex items-center gap-4 p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </CardContent>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}

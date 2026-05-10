'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import { Settings, ArrowLeft, Save, AlertTriangle } from 'lucide-react';
import { ProviderModelSelect } from '@/components/llm-providers/provider-model-select';
import { useLlmProviders } from '@/hooks/use-llm-providers';

interface KbConfig {
  id: string;
  name: string;
  description: string | null;
  status: string;
  chunkStrategy: string;
  chunkSize: number;
  chunkOverlap: number;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimensions: number;
}

export default function KnowledgeBaseSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const [kb, setKb] = useState<KbConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<KbConfig>>({});
  const { data: providers } = useLlmProviders();

  useEffect(() => {
    fetch(`/api/knowledge-bases/${id}`)
      .then((res) => res.json())
      .then((data) => {
        setKb(data);
        setForm({
          name: data.name,
          description: data.description ?? '',
          status: data.status,
          chunkStrategy: data.chunkStrategy,
          chunkSize: data.chunkSize,
          chunkOverlap: data.chunkOverlap,
          embeddingProvider: data.embeddingProvider,
          embeddingModel: data.embeddingModel,
          embeddingDimensions: data.embeddingDimensions,
        });
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load settings');
        setLoading(false);
      });
  }, [id]);

  const update = (key: keyof KbConfig, value: string | number) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleModelChange = (modelId: string) => {
    if (!providers) return;
    for (const provider of providers) {
      const discovered = (provider.models as { models?: Array<{ id: string }> } | null)?.models ?? [];
      const hasModel = discovered.some((m) => m.id === modelId);
      if (hasModel || provider.embeddingModel === modelId) {
        update('embeddingProvider', provider.id);
        update('embeddingModel', modelId);
        update('embeddingDimensions', provider.embeddingDimensions ?? 1024);
        return;
      }
    }
    update('embeddingModel', modelId);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/knowledge-bases/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <Link href={`/knowledge-bases/${id}`} aria-label="Back" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Settings className="h-5 w-5" />
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
              <CardDescription>Basic knowledge base information.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={form.name ?? ''}
                  onChange={(e) => update('name', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={form.description ?? ''}
                  onChange={(e) => update('description', e.target.value)}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={form.status} onValueChange={(v) => update('status', v)}>
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Embedding</CardTitle>
              <CardDescription>Model used to generate document embeddings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Re-ingestion required</AlertTitle>
                <AlertDescription>
                  Changing embedding settings requires re-ingesting all documents. Existing vectors will become incompatible.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Label htmlFor="embeddingModel">Embedding Model</Label>
                <ProviderModelSelect
                  capability="embedding"
                  value={form.embeddingModel ?? ''}
                  onChange={handleModelChange}
                  placeholder="Select an embedding model"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="embeddingProvider">Provider ID</Label>
                  <Input
                    id="embeddingProvider"
                    value={form.embeddingProvider ?? ''}
                    disabled
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="embeddingDimensions">Dimensions</Label>
                  <Input
                    id="embeddingDimensions"
                    type="number"
                    value={form.embeddingDimensions ?? 1024}
                    disabled
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Chunking</CardTitle>
              <CardDescription>
                Changes apply to newly ingested documents only.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="strategy">Strategy</Label>
                <Select value={form.chunkStrategy} onValueChange={(v) => update('chunkStrategy', v)}>
                  <SelectTrigger id="strategy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RECURSIVE_CHARACTER">Recursive Character</SelectItem>
                    <SelectItem value="FIXED_SIZE">Fixed Size</SelectItem>
                    <SelectItem value="SEMANTIC">Semantic</SelectItem>
                    <SelectItem value="MARKDOWN_AWARE">Markdown Aware</SelectItem>
                    <SelectItem value="CODE_AWARE">Code Aware</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="chunkSize">Chunk Size (tokens)</Label>
                  <Input
                    id="chunkSize"
                    type="number"
                    value={form.chunkSize ?? 512}
                    onChange={(e) => update('chunkSize', parseInt(e.target.value, 10))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="chunkOverlap">Overlap (tokens)</Label>
                  <Input
                    id="chunkOverlap"
                    type="number"
                    value={form.chunkOverlap ?? 50}
                    onChange={(e) => update('chunkOverlap', parseInt(e.target.value, 10))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

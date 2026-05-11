'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
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
const schema = z.object({
  name: z.string().min(1, 'Name is required').max(255).optional(),
  description: z.string().max(1000).optional(),
  status: z.enum(['active', 'archived']).optional(),
  embeddingProvider: z.string().min(1).optional(),
  embeddingModel: z.string().min(1).optional(),
  embeddingDimensions: z.number().int().min(64).max(3072).optional(),
  chunkStrategy: z.enum(['FIXED_SIZE', 'RECURSIVE_CHARACTER', 'SEMANTIC', 'MARKDOWN_AWARE', 'CODE_AWARE']).optional(),
  chunkSize: z.number().int().min(64).max(8192).optional(),
  chunkOverlap: z.number().int().min(0).max(512).optional(),
});

type UpdateKbFormValues = z.infer<typeof schema>;

export default function KnowledgeBaseSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const [kb, setKb] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const { data: providers } = useLlmProviders();

  const form = useForm({
    defaultValues: {
      name: '',
      description: '',
      status: 'active',
      chunkStrategy: 'RECURSIVE_CHARACTER',
      chunkSize: 512,
      chunkOverlap: 50,
      embeddingProvider: '',
      embeddingModel: '',
      embeddingDimensions: 1024,
    } as UpdateKbFormValues,
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      const res = await fetch(`/api/knowledge-bases/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success('Settings saved');
    },
  });

  useEffect(() => {
    fetch(`/api/knowledge-bases/${id}`)
      .then((res) => res.json())
      .then((data) => {
        setKb(data);
        form.setFieldValue('name', data.name);
        form.setFieldValue('description', data.description ?? '');
        form.setFieldValue('status', data.status);
        form.setFieldValue('chunkStrategy', data.chunkStrategy);
        form.setFieldValue('chunkSize', data.chunkSize);
        form.setFieldValue('chunkOverlap', data.chunkOverlap);
        form.setFieldValue('embeddingProvider', data.embeddingProvider);
        form.setFieldValue('embeddingModel', data.embeddingModel);
        form.setFieldValue('embeddingDimensions', data.embeddingDimensions);
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load settings');
        setLoading(false);
      });
  }, [id]);

  const handleModelChange = (modelId: string) => {
    if (!providers) return;
    for (const provider of providers) {
      const discovered = (provider.models as { models?: Array<{ id: string }> } | null)?.models ?? [];
      const hasModel = discovered.some((m) => m.id === modelId);
      if (hasModel || provider.embeddingModel === modelId) {
        form.setFieldValue('embeddingProvider', provider.id);
        form.setFieldValue('embeddingModel', modelId);
        form.setFieldValue('embeddingDimensions', provider.embeddingDimensions ?? 1024);
        return;
      }
    }
    form.setFieldValue('embeddingModel', modelId);
  };

  if (loading) {
    return (
      <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 max-w-2xl">
        <div className="flex items-center gap-2">
          <Link href={`/knowledge-bases/${id}`} aria-label="Back" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Settings className="h-5 w-5" />
          <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      </div>
    );
  }

  if (!kb) {
    return (
      <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 max-w-2xl">
        <p className="text-muted-foreground">Knowledge base not found.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <Link href={`/knowledge-bases/${id}`} aria-label="Back" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Settings className="h-5 w-5" />
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
        className="space-y-6"
      >
        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>Basic knowledge base information.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form.Field name="name">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Name</Label>
                  <Input
                    id={field.name}
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                  )}
                </div>
              )}
            </form.Field>
            <form.Field name="description">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Description</Label>
                  <Textarea
                    id={field.name}
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    rows={3}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="status">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Status</Label>
                  <Select value={field.state.value ?? 'active'} onValueChange={(v) => field.handleChange(v as "active" | "archived")}>
                    <SelectTrigger id={field.name}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>
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

            <form.Field name="embeddingModel">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Embedding Model</Label>
                  <ProviderModelSelect
                    capability="embedding"
                    value={field.state.value ?? ''}
                    onChange={handleModelChange}
                    placeholder="Select an embedding model"
                  />
                </div>
              )}
            </form.Field>

            <div className="grid grid-cols-2 gap-4">
              <form.Field name="embeddingProvider">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Provider ID</Label>
                    <Input id={field.name} value={field.state.value ?? ''} disabled />
                  </div>
                )}
              </form.Field>
              <form.Field name="embeddingDimensions">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Dimensions</Label>
                    <Input id={field.name} type="number" value={field.state.value ?? 1024} disabled />
                  </div>
                )}
              </form.Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Chunking</CardTitle>
            <CardDescription>Changes apply to newly ingested documents only.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form.Field name="chunkStrategy">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Strategy</Label>
                  <Select value={field.state.value ?? 'RECURSIVE_CHARACTER'} onValueChange={(v) => field.handleChange(v as "FIXED_SIZE" | "RECURSIVE_CHARACTER" | "SEMANTIC" | "MARKDOWN_AWARE" | "CODE_AWARE")}>
                    <SelectTrigger id={field.name}>
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
              )}
            </form.Field>
            <div className="grid grid-cols-2 gap-4">
              <form.Field name="chunkSize">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Chunk Size (tokens)</Label>
                    <Input
                      id={field.name}
                      type="number"
                      min={64}
                      max={8192}
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : 0)}
                      onBlur={field.handleBlur}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                    )}
                  </div>
                )}
              </form.Field>
              <form.Field name="chunkOverlap">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Overlap (tokens)</Label>
                    <Input
                      id={field.name}
                      type="number"
                      min={0}
                      max={512}
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : 0)}
                      onBlur={field.handleBlur}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                    )}
                  </div>
                )}
              </form.Field>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={form.state.isSubmitting}>
            <Save className="h-4 w-4 mr-2" />
            {form.state.isSubmitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Database, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import Link from 'next/link';
import { ProviderModelSelect } from '@/components/llm-providers/provider-model-select';
import { useLlmProviders } from '@/hooks/use-llm-providers';
const STEPS = ['Basic Info', 'Embedding', 'Chunking', 'Review'];

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(1000).optional(),
  embeddingProvider: z.string().min(1, 'Provider is required'),
  embeddingModel: z.string().min(1, 'Model is required'),
  embeddingDimensions: z.number().int().min(64).max(3072),
  chunkStrategy: z.enum(['FIXED_SIZE', 'RECURSIVE_CHARACTER', 'SEMANTIC', 'MARKDOWN_AWARE', 'CODE_AWARE']),
  chunkSize: z.number().int().min(64).max(8192),
  chunkOverlap: z.number().int().min(0).max(512),
});

type CreateKbFormValues = z.infer<typeof schema>;

export default function NewKnowledgeBasePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const { data: providers } = useLlmProviders();

  const form = useForm({
    defaultValues: {
      name: '',
      description: '',
      embeddingProvider: '',
      embeddingModel: '',
      embeddingDimensions: 1024,
      chunkStrategy: 'RECURSIVE_CHARACTER',
      chunkSize: 512,
      chunkOverlap: 50,
    } as CreateKbFormValues,
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      const res = await fetch('/api/knowledge-bases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to create');
      }
      const kb = await res.json();
      toast.success('Knowledge base created');
      router.push(`/knowledge-bases/${kb.id}`);
    },
  });

  const handleModelChange = (modelId: string) => {
    if (!providers) return;
    for (const provider of providers) {
      const discovered =
        (provider.models as { models?: Array<{ id: string; name: string; capabilities: string[] }> } | null)?.models ?? [];
      const match = discovered.find((m) => m.id === modelId && m.capabilities.includes('embedding'));
      if (match || provider.embeddingModel === modelId) {
        form.setFieldValue('embeddingProvider', provider.id);
        form.setFieldValue('embeddingModel', modelId);
        form.setFieldValue('embeddingDimensions', provider.embeddingDimensions ?? 1024);
        return;
      }
    }
    form.setFieldValue('embeddingModel', modelId);
  };

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-2">
        <Link href="/knowledge-bases" aria-label="Back" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2">
          <Database className="h-6 w-6" />
          <h2 className="text-2xl font-bold tracking-tight">New Knowledge Base</h2>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                i < step
                  ? 'bg-primary text-primary-foreground'
                  : i === step
                  ? 'bg-primary/20 text-primary border border-primary'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span className={`text-sm ${i === step ? 'font-medium' : 'text-muted-foreground'}`}>{label}</span>
            {i < STEPS.length - 1 && <div className="h-px w-8 bg-border" />}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>{STEPS[step]}</CardTitle>
            <CardDescription>
              {step === 0 && 'Give your knowledge base a name and description.'}
              {step === 1 && 'Choose how documents will be embedded for semantic search.'}
              {step === 2 && 'Configure how documents are split into chunks.'}
              {step === 3 && 'Review your configuration before creating.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === 0 && (
              <>
                <form.Field name="name">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Name *</Label>
                      <Input
                        id={field.name}
                        placeholder="e.g. Product Documentation"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        autoFocus
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
                        placeholder="What documents will this knowledge base contain?"
                        value={field.state.value ?? ''}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        rows={3}
                      />
                    </div>
                  )}
                </form.Field>
              </>
            )}

            {step === 1 && (
              <>
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
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                      )}
                    </div>
                  )}
                </form.Field>
                <form.Field name="embeddingDimensions">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Dimensions</Label>
                      <Input
                        id={field.name}
                        type="number"
                        min={64}
                        max={3072}
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
              </>
            )}

            {step === 2 && (
              <>
                <form.Field name="chunkStrategy">
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Chunking Strategy</Label>
                      <Select value={field.state.value} onValueChange={(v) => field.handleChange(v as "FIXED_SIZE" | "RECURSIVE_CHARACTER" | "SEMANTIC" | "MARKDOWN_AWARE" | "CODE_AWARE")}>
                        <SelectTrigger id={field.name}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="RECURSIVE_CHARACTER">Recursive Character (recommended)</SelectItem>
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
              </>
            )}

            {step === 3 && (
              <div className="space-y-3">
                {[
                  { label: 'Name', value: form.getFieldValue('name') },
                  { label: 'Description', value: form.getFieldValue('description') || '—' },
                  { label: 'Embedding Provider', value: form.getFieldValue('embeddingProvider') },
                  { label: 'Embedding Model', value: form.getFieldValue('embeddingModel') },
                  { label: 'Dimensions', value: String(form.getFieldValue('embeddingDimensions')) },
                  { label: 'Chunk Strategy', value: form.getFieldValue('chunkStrategy') },
                  { label: 'Chunk Size', value: `${form.getFieldValue('chunkSize')} tokens` },
                  { label: 'Chunk Overlap', value: `${form.getFieldValue('chunkOverlap')} tokens` },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <Badge variant="outline">{value}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <form.Subscribe
          selector={(state) => ({
            name: state.values.name,
            embeddingModel: state.values.embeddingModel,
          })}
        >
          {({ name, embeddingModel }) => {
            const advanceable =
              step === 0 ? name?.trim().length > 0 : step === 1 ? !!embeddingModel : true;
            return (
              <div className="flex justify-between">
                <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!advanceable}>
                    Next
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                ) : (
                  <Button type="submit" disabled={form.state.isSubmitting}>
                    {form.state.isSubmitting ? 'Creating...' : 'Create Knowledge Base'}
                  </Button>
                )}
              </div>
            );
          }}
        </form.Subscribe>
      </form>
    </div>
  );
}

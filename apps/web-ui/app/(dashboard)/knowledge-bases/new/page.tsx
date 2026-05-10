'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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

interface FormData {
  name: string;
  description: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimensions: number;
  chunkStrategy: string;
  chunkSize: number;
  chunkOverlap: number;
}

interface SelectedProviderInfo {
  id: string;
  name: string;
  embeddingDimensions: number | null;
}



export default function NewKnowledgeBasePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<FormData>({
    name: '',
    description: '',
    embeddingProvider: '',
    embeddingModel: '',
    embeddingDimensions: 1024,
    chunkStrategy: 'RECURSIVE_CHARACTER',
    chunkSize: 512,
    chunkOverlap: 50,
  });
  const [selectedProvider, setSelectedProvider] = useState<SelectedProviderInfo | null>(null);
  const { data: providers } = useLlmProviders();

  const handleModelChange = (modelId: string) => {
    if (!providers) return;
    // Find which provider owns this model
    for (const provider of providers) {
      const discovered = (provider.models as { models?: Array<{ id: string; name: string }> } | null)?.models ?? [];
      const match = discovered.find((m) => m.id === modelId);
      if (match) {
        setSelectedProvider({ id: provider.id, name: provider.name, embeddingDimensions: provider.embeddingDimensions });
        setForm((prev) => ({
          ...prev,
          embeddingProvider: provider.id,
          embeddingModel: modelId,
          embeddingDimensions: provider.embeddingDimensions ?? prev.embeddingDimensions,
        }));
        return;
      }
    }
    // Fallback: if no discovered model matches, just store the model ID
    setForm((prev) => ({ ...prev, embeddingModel: modelId }));
  };

  const update = (key: keyof FormData, value: string | number) =>
    setForm((prev) => ({ ...prev, [key]: value }));



  const canAdvance = () => {
    if (step === 0) return form.name.trim().length > 0;
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/knowledge-bases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to create');
      }
      const kb = await res.json();
      toast.success('Knowledge base created');
      router.push(`/knowledge-bases/${kb.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create knowledge base');
      setSubmitting(false);
    }
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

      {/* Step indicator */}
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
            <span className={`text-sm ${i === step ? 'font-medium' : 'text-muted-foreground'}`}>
              {label}
            </span>
            {i < STEPS.length - 1 && <div className="h-px w-8 bg-border" />}
          </div>
        ))}
      </div>

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
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g. Product Documentation"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="What documents will this knowledge base contain?"
                  value={form.description}
                  onChange={(e) => update('description', e.target.value)}
                  rows={3}
                />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="model">Embedding Model</Label>
                <ProviderModelSelect
                  capability="embedding"
                  value={form.embeddingModel}
                  onChange={handleModelChange}
                  placeholder="Select an embedding model"
                />
                {selectedProvider && (
                  <p className="text-xs text-muted-foreground">
                    Provider: {selectedProvider.name}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="dims">Dimensions</Label>
                <Input
                  id="dims"
                  type="number"
                  value={form.embeddingDimensions}
                  onChange={(e) => update('embeddingDimensions', parseInt(e.target.value, 10))}
                />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="strategy">Chunking Strategy</Label>
                <Select value={form.chunkStrategy} onValueChange={(v) => update('chunkStrategy', v)}>
                  <SelectTrigger id="strategy">
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="chunkSize">Chunk Size (tokens)</Label>
                  <Input
                    id="chunkSize"
                    type="number"
                    value={form.chunkSize}
                    onChange={(e) => update('chunkSize', parseInt(e.target.value, 10))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="chunkOverlap">Overlap (tokens)</Label>
                  <Input
                    id="chunkOverlap"
                    type="number"
                    value={form.chunkOverlap}
                    onChange={(e) => update('chunkOverlap', parseInt(e.target.value, 10))}
                  />
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <div className="space-y-3">
              {[
                { label: 'Name', value: form.name },
                { label: 'Description', value: form.description || '—' },
                { label: 'Embedding Provider', value: form.embeddingProvider },
                { label: 'Embedding Model', value: form.embeddingModel },
                { label: 'Dimensions', value: String(form.embeddingDimensions) },
                { label: 'Chunk Strategy', value: form.chunkStrategy },
                { label: 'Chunk Size', value: `${form.chunkSize} tokens` },
                { label: 'Chunk Overlap', value: `${form.chunkOverlap} tokens` },
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

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance()}>
            Next
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Knowledge Base'}
          </Button>
        )}
      </div>
    </div>
  );
}

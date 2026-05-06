'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCreateLlmProvider } from '@/hooks/use-llm-providers';
import { LlmProviderForm } from '@/components/llm-providers/llm-provider-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

export default function NewLlmProviderPage() {
  const router = useRouter();
  const createMutation = useCreateLlmProvider();

  const handleSubmit = async (values: {
    name: string;
    provider: 'bedrock' | 'openai';
    chatModel?: string | null;
    embeddingModel?: string | null;
    embeddingDimensions?: number | null;
    baseUrl?: string | null;
    apiKey?: string | null;
    isDefault?: boolean;
  }) => {
    try {
      await createMutation.mutateAsync(values);
      toast.success('LLM provider created');
      router.push('/agents/llm-providers');
    } catch {
      toast.error('Failed to create LLM provider');
    }
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" render={<Link href="/agents/llm-providers" aria-label="Back to providers" />}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">New LLM Provider</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provider Details</CardTitle>
          <CardDescription>Configure the model, endpoint, and credentials for your LLM provider.</CardDescription>
        </CardHeader>
        <CardContent>
          <LlmProviderForm onSubmit={handleSubmit} loading={createMutation.isPending} submitLabel="Create Provider" />
        </CardContent>
      </Card>
    </div>
  );
}

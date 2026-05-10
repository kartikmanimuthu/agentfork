'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLlmProvider, useUpdateLlmProvider } from '@/hooks/use-llm-providers';
import { LlmProviderForm } from '@/components/llm-providers/llm-provider-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProviderType } from '@chatbot/shared';

export default function EditLlmProviderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const providerId = params.id;

  const { data: provider, isLoading } = useLlmProvider(providerId);
  const updateMutation = useUpdateLlmProvider(providerId);

  const handleSubmit = async (values: {
    name: string;
    providerType: ProviderType;
    region?: string;
    credentials: Record<string, string>;
    chatModel?: string;
    embeddingModel?: string;
    embeddingDimensions?: number;
    isDefault?: boolean;
  }) => {
    try {
      await updateMutation.mutateAsync(values);
      toast.success('LLM provider updated');
      router.push('/agents/llm-providers');
    } catch {
      toast.error('Failed to update LLM provider');
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 max-w-2xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 max-w-2xl mx-auto">
        <p className="text-muted-foreground">Provider not found.</p>
        <Link href="/agents/llm-providers">
          <Button variant="outline">Back to providers</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Link href="/agents/llm-providers" aria-label="Back to providers">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h2 className="text-2xl font-bold tracking-tight">Edit LLM Provider</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provider Details</CardTitle>
          <CardDescription>Update the model, endpoint, and credentials for your LLM provider.</CardDescription>
        </CardHeader>
        <CardContent>
          <LlmProviderForm
            defaultValues={{
              name: provider.name,
              providerType: provider.providerType,
              region: provider.region ?? undefined,
              chatModel: provider.chatModel ?? undefined,
              embeddingModel: provider.embeddingModel ?? undefined,
              embeddingDimensions: provider.embeddingDimensions ?? undefined,
              isDefault: provider.isDefault,
            }}
            onSubmit={handleSubmit}
            loading={updateMutation.isPending}
            submitLabel="Update Provider"
          />
        </CardContent>
      </Card>
    </div>
  );
}

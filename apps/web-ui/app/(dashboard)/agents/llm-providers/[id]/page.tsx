'use client';

import { useParams, useRouter } from 'next/navigation';
import { useLlmProvider, useUpdateLlmProvider } from '@/hooks/use-llm-providers';
import { LlmProviderForm } from '@/components/llm-providers/llm-provider-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export default function LlmProviderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const providerId = params.id;

  const { data: provider, isLoading } = useLlmProvider(providerId);
  const updateMutation = useUpdateLlmProvider(providerId);

  if (isLoading) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 max-w-2xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <p className="text-muted-foreground">LLM provider not found.</p>
          <Button variant="outline" onClick={() => router.push('/agents/llm-providers')}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back to Providers
          </Button>
        </div>
      </div>
    );
  }

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
      await updateMutation.mutateAsync(values);
      toast.success('LLM provider updated');
    } catch {
      toast.error('Failed to update LLM provider');
    }
  };

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 bg-background max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push('/agents/llm-providers')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Sparkles className="h-5 w-5" />
        <h2 className="text-2xl font-bold tracking-tight">{provider.name}</h2>
        {provider.isDefault && <Badge variant="default">Default</Badge>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>Update the model and connection settings for this provider.</CardDescription>
        </CardHeader>
        <CardContent>
          <LlmProviderForm
            defaultValues={{
              name: provider.name,
              provider: provider.provider,
              chatModel: provider.chatModel,
              embeddingModel: provider.embeddingModel,
              embeddingDimensions: provider.embeddingDimensions,
              baseUrl: provider.baseUrl,
              apiKey: provider.apiKey,
              isDefault: provider.isDefault,
            }}
            onSubmit={handleSubmit}
            loading={updateMutation.isPending}
            submitLabel="Save Changes"
          />
        </CardContent>
      </Card>
    </div>
  );
}

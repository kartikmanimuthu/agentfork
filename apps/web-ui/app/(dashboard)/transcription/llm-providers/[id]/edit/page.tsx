'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranscriptionProvider, useUpdateTranscriptionProvider } from '@/hooks/use-transcription-providers';
import { TranscriptionProviderForm } from '@/components/transcription-providers/transcription-provider-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';

export default function EditTranscriptionProviderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const providerId = params.id;

  const { data: provider, isLoading } = useTranscriptionProvider(providerId);
  const updateMutation = useUpdateTranscriptionProvider(providerId);

  const handleSubmit: Parameters<typeof TranscriptionProviderForm>[0]['onSubmit'] = async (values) => {
    try {
      await updateMutation.mutateAsync({
        name: values.name,
        endpointUrl: values.endpointUrl,
        credentials: Object.keys(values.credentials).length > 0 ? values.credentials : undefined,
        modelId: values.modelId,
        isDefault: values.isDefault,
      });
      toast.success('Provider updated');
      router.push(`/transcription/llm-providers/${providerId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update provider');
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
        <Button variant="outline" render={<Link href="/transcription/llm-providers" />}>
          Back to providers
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          render={<Link href={`/transcription/llm-providers/${providerId}`} aria-label="Back to provider" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">Edit Provider</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provider Details</CardTitle>
          <CardDescription>Update the model, endpoint, and credentials for this transcription provider.</CardDescription>
        </CardHeader>
        <CardContent>
          <TranscriptionProviderForm
            defaultValues={{
              name: provider.name,
              providerType: provider.providerType,
              endpointUrl: provider.endpointUrl ?? undefined,
              modelId: provider.modelId ?? undefined,
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

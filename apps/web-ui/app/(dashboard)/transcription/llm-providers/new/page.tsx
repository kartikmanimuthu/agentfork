'use client';

import { useRouter } from 'next/navigation';
import { TranscriptionProviderForm } from '@/components/transcription-providers/transcription-provider-form';
import { useCreateTranscriptionProvider } from '@/hooks/use-transcription-providers';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import { createTranscriptionModelSchema } from '@chatbot/shared/client';

export default function NewTranscriptionProviderPage() {
  const router = useRouter();
  const createMutation = useCreateTranscriptionProvider();

  const handleSubmit: Parameters<typeof TranscriptionProviderForm>[0]['onSubmit'] = async (values) => {
    const parsed = createTranscriptionModelSchema.safeParse(values);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    try {
      const provider = await createMutation.mutateAsync(values);
      toast.success('Provider created successfully');
      router.push(`/transcription/llm-providers/${provider.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create provider');
    }
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-6 w-6" />
        <h2 className="text-3xl font-bold tracking-tight">New Transcription Provider</h2>
      </div>
      <p className="text-muted-foreground">
        Connect an ASR provider (vLLM, LiteLLM, OpenAI-compatible, or a custom endpoint).
      </p>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Provider Setup</CardTitle>
          <CardDescription>
            Follow the 3 steps to configure your provider and discover available speech-to-text models.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TranscriptionProviderForm
            onSubmit={handleSubmit}
            loading={createMutation.isPending}
            submitLabel="Create Provider"
          />
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  useTranscriptionProviders,
  useDeleteTranscriptionProvider,
  useSetDefaultTranscriptionProvider,
  useRefreshTranscriptionModels,
} from '@/hooks/use-transcription-providers';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TranscriptionProviderDeleteDialog } from '@/components/transcription-providers/transcription-provider-delete-dialog';
import { toast } from 'sonner';
import { Plus, Settings, Trash2, Star, Sparkles, RefreshCw, Mic } from 'lucide-react';

const PROVIDER_LABELS: Record<string, string> = {
  BEDROCK: 'Amazon Bedrock',
  OLLAMA: 'Ollama',
  VLLM: 'vLLM',
  LITELLM: 'LiteLLM Gateway',
  OPENAI_COMPATIBLE: 'OpenAI Compatible',
  CUSTOM: 'Custom Endpoint',
};

export default function TranscriptionLlmProvidersPage() {
  const { data: providers, isLoading } = useTranscriptionProviders();
  const deleteMutation = useDeleteTranscriptionProvider();
  const setDefaultMutation = useSetDefaultTranscriptionProvider();
  const refreshMutation = useRefreshTranscriptionModels();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast.success('Provider deleted');
      setDeleteId(null);
    } catch {
      toast.error('Failed to delete provider');
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultMutation.mutateAsync(id);
      toast.success('Default provider updated');
    } catch {
      toast.error('Failed to set default provider');
    }
  };

  const handleRefresh = async (id: string) => {
    try {
      await refreshMutation.mutateAsync(id);
      toast.success('Models refreshed');
    } catch {
      toast.error('Failed to refresh models');
    }
  };

  const deletingProvider = providers?.find((p) => p.id === deleteId);

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-6 w-6" />
        <h2 className="text-3xl font-bold tracking-tight">LLM Providers</h2>
      </div>
      <p className="text-muted-foreground">
        Configure ASR/transcription providers (vLLM, LiteLLM, OpenAI-compatible, Custom) used for speech-to-text inference.
      </p>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>All Providers</CardTitle>
              <CardDescription>
                {isLoading ? (
                  <Skeleton className="h-4 w-32" />
                ) : (
                  `${providers?.length ?? 0} provider${(providers?.length ?? 0) !== 1 ? 's' : ''}`
                )}
              </CardDescription>
            </div>
            <Link href="/transcription/llm-providers/new" className={buttonVariants()}>
              <Plus className="h-4 w-4 mr-2" />New Provider
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !providers?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-3">
              <Mic className="h-10 w-10 opacity-30" />
              <p className="text-sm">No transcription providers yet.</p>
              <Link href="/transcription/llm-providers/new" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <Plus className="h-4 w-4 mr-2" />Add your first provider
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {providers.map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-center justify-between rounded-lg border p-4 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{provider.name}</span>
                        {provider.isDefault && <Badge variant="default" className="text-xs">Default</Badge>}
                        {provider.activeVersionId && (
                          <Badge variant="outline" className="text-xs text-green-700 border-green-300">Live</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="secondary" className="text-xs">
                          {PROVIDER_LABELS[provider.providerType] ?? provider.providerType}
                        </Badge>
                        {provider.modelId && (
                          <span className="text-xs text-muted-foreground">{provider.modelId}</span>
                        )}
                        {provider.region && (
                          <span className="text-xs text-muted-foreground">{provider.region}</span>
                        )}
                        {provider.credentialsConfigured && (
                          <span className="text-xs text-green-600" title="Credentials configured">●</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleRefresh(provider.id)}
                      disabled={refreshMutation.isPending}
                      aria-label="Scan / refresh models"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    {!provider.isDefault && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleSetDefault(provider.id)}
                        disabled={setDefaultMutation.isPending}
                        aria-label="Set as default"
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    )}
                    <Link
                      href={`/transcription/llm-providers/${provider.id}`}
                      className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'h-8 w-8' })}
                      aria-label="Edit provider"
                    >
                      <Settings className="h-4 w-4" />
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(provider.id)}
                      aria-label="Delete provider"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <TranscriptionProviderDeleteDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        providerName={deletingProvider?.name ?? ''}
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

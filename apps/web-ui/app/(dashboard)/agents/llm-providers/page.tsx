'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLlmProviders, useDeleteLlmProvider, useSetDefaultLlmProvider } from '@/hooks/use-llm-providers';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Plus, Settings, Trash2, Star, Sparkles } from 'lucide-react';
import { LlmProviderDeleteDialog } from '@/components/llm-providers/llm-provider-delete-dialog';

export default function LlmProvidersPage() {
  const { data: providers, isLoading } = useLlmProviders();
  const deleteMutation = useDeleteLlmProvider();
  const setDefaultMutation = useSetDefaultLlmProvider();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast.success('LLM provider deleted');
      setDeleteId(null);
    } catch {
      toast.error('Failed to delete LLM provider');
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

  const getProviderLabel = (p: string) => {
    switch (p) {
      case 'bedrock': return 'Amazon Bedrock';
      case 'openai': return 'OpenAI Compatible';
      default: return p;
    }
  };

  const deletingProvider = providers?.find((p) => p.id === deleteId);

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-6 w-6" />
        <h2 className="text-3xl font-bold tracking-tight">LLM Providers</h2>
      </div>
      <p className="text-muted-foreground">Manage LLM providers for chat inference and embeddings.</p>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>All Providers</CardTitle>
              <CardDescription>
                {isLoading ? <Skeleton className="h-4 w-32" /> : `${providers?.length ?? 0} provider${(providers?.length ?? 0) !== 1 ? 's' : ''}`}
              </CardDescription>
            </div>
            <Link href="/agents/llm-providers/new" className={buttonVariants()}>
              <Plus className="h-4 w-4 mr-2" />New Provider
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : providers?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No LLM providers yet. Create one to get started.</div>
          ) : (
            <div className="space-y-2">
              {providers?.map((provider) => (
                <div key={provider.id} className="flex items-center justify-between rounded-lg border p-4 hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{provider.name}</span>
                        {provider.isDefault && <Badge variant="default" className="text-xs">Default</Badge>}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">{getProviderLabel(provider.provider)}</Badge>
                        {provider.chatModel && <span className="text-xs text-muted-foreground">{provider.chatModel}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!provider.isDefault && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleSetDefault(provider.id)}
                        aria-label="Set as default"
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    )}
                    <Link href={`/agents/llm-providers/${provider.id}`} className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'h-8 w-8' })} aria-label="Edit">
                      <Settings className="h-4 w-4" />
                    </Link>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(provider.id)} aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <LlmProviderDeleteDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        providerName={deletingProvider?.name ?? ''}
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

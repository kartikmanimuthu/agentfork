'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLlmProvider } from '@/hooks/use-llm-providers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Settings, Sparkles } from 'lucide-react';

export default function LlmProviderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const providerId = params.id;
  const { data: provider, isLoading } = useLlmProvider(providerId);

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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Provider Details</CardTitle>
              <CardDescription>View and manage this LLM provider configuration.</CardDescription>
            </div>
            <Link href={`/agents/llm-providers/${provider.id}/edit`}>
              <Button variant="outline" size="sm">
                <Settings className="h-4 w-4 mr-2" />Edit
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Provider Type</p>
              <p className="font-medium">{provider.providerType}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Region</p>
              <p className="font-medium">{provider.region ?? '—'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Chat Model</p>
              <p className="font-medium">{provider.chatModel ?? '—'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Embedding Model</p>
              <p className="font-medium">{provider.embeddingModel ?? '—'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Embedding Dimensions</p>
              <p className="font-medium">{provider.embeddingDimensions ?? '—'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Credentials</p>
              <p className="font-medium">{provider.credentialsConfigured ? 'Configured' : 'Not configured'}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranscriptionJobConfig, useTranscriptionJobConfigVersions } from '@/hooks/use-transcription-job-configs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  AudioLines,
  ArrowLeft,
  Play,
  Pencil,
  Key,
  Clock,
  Tag,
  Mic,
} from 'lucide-react';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  draft: 'secondary',
  archived: 'outline',
};

export default function TranscriptionJobOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: job, isLoading, error } = useTranscriptionJobConfig(id);
  const { data: versions } = useTranscriptionJobConfigVersions(id);

  if (isLoading) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 max-w-3xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <p className="text-muted-foreground">Job not found.</p>
          <Button variant="outline" onClick={() => router.push('/transcription/jobs')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Jobs
          </Button>
        </div>
      </div>
    );
  }

  const config = (job.config ?? {}) as Record<string, unknown>;
  const language = config.language as string | undefined;
  const diarize = Boolean(config.diarize);
  const publishedVersion = versions?.find((v) => v.status === 'published');
  const latestVersion = versions?.[0];

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          render={<Link href="/transcription/jobs" aria-label="Back to jobs" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <AudioLines className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold tracking-tight">{job.name}</h2>
          {job.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{job.description}</p>
          )}
        </div>
        <Badge variant={STATUS_VARIANT[job.status] ?? 'secondary'} className="capitalize">{job.status}</Badge>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button render={<Link href={`/transcription/jobs/${id}/playground`} />}>
          <Play className="h-4 w-4 mr-2" />
          Open Playground
        </Button>
        <Button variant="outline" render={<Link href={`/transcription/jobs/${id}/edit`} />}>
          <Pencil className="h-4 w-4 mr-2" />
          Edit Job
        </Button>
        <Button variant="ghost" size="sm" render={<Link href={`/transcription/jobs/${id}/edit?tab=keys`} />}>
          <Key className="h-4 w-4 mr-1" />
          API Keys
        </Button>
      </div>

      <Separator />

      {/* Configuration (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground text-xs block mb-1">Provider</span>
              <span className="font-medium">{job.model?.name ?? '—'}</span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs block mb-1">Model</span>
              <span className="font-mono text-sm">{job.model?.modelId ?? 'Default'}</span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs block mb-1">Language</span>
              <span>{language || 'Auto-detect'}</span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs block mb-1">Diarization</span>
              <span className="flex items-center gap-1">
                <Mic className="h-3.5 w-3.5 text-muted-foreground" />
                {diarize ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Versions summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Versions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground text-xs block mb-1">Total Versions</span>
              <span className="font-semibold">{versions?.length ?? 0}</span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs block mb-1">Published</span>
              <span className="font-semibold">{publishedVersion ? `v${publishedVersion.version}` : '—'}</span>
            </div>
          </div>
          {latestVersion && (
            <div className="pt-2 text-xs text-muted-foreground">
              Latest: v{latestVersion.version} ({latestVersion.status}) · created{' '}
              {new Date(latestVersion.createdAt).toLocaleDateString()}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Links */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Quick Links
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" render={<Link href={`/transcription/jobs/${id}/edit`} />}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit Configuration
            </Button>
            <Button variant="outline" size="sm" render={<Link href={`/transcription/jobs/${id}/playground`} />}>
              <Play className="h-3.5 w-3.5 mr-1.5" />
              Test in Playground
            </Button>
            <Button variant="outline" size="sm" render={<Link href={`/transcription/jobs/${id}/edit?tab=keys`} />}>
              <Key className="h-3.5 w-3.5 mr-1.5" />
              Manage API Keys
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

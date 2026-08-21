'use client';

import { use, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranscriptionProviders } from '@/hooks/use-transcription-providers';
import {
  useTranscriptionJobConfig,
  useUpdateTranscriptionJobConfig,
  useTranscriptionJobConfigVersions,
  useCreateTranscriptionJobConfigVersion,
  usePublishTranscriptionJobConfigVersion,
  type TranscriptionJobConfig,
  type UpdateJobConfigInput,
} from '@/hooks/use-transcription-job-configs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { ArrowLeft, AudioLines, Play, GitBranch, KeyRound, Settings, Upload, CheckCircle2, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { JobApiKeysPanel } from '@/components/transcription-jobs/job-api-keys-panel';

const STATUS_COLORS: Record<string, string> = {
  draft: 'secondary',
  published: 'default',
  archived: 'outline',
};

export default function TranscriptionJobEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const defaultTab = searchParams.get('tab') === 'keys' ? 'keys' : searchParams.get('tab') === 'versions' ? 'versions' : 'configure';

  const { data: config, isLoading } = useTranscriptionJobConfig(id);
  const { data: versions, isLoading: versionsLoading } = useTranscriptionJobConfigVersions(id);
  const updateMutation = useUpdateTranscriptionJobConfig(id);
  const createVersionMutation = useCreateTranscriptionJobConfigVersion(id);
  const publishVersionMutation = usePublishTranscriptionJobConfigVersion(id);
  const [changeNotes, setChangeNotes] = useState('');

  const handleUpdate = (updates: UpdateJobConfigInput) => {
    updateMutation.mutate(updates, {
      onSuccess: () => toast.success('Job updated'),
      onError: (e) => toast.error(e.message),
    });
  };

  const handleCreateSnapshot = () => {
    createVersionMutation.mutate(changeNotes, {
      onSuccess: () => { setChangeNotes(''); toast.success('Snapshot created'); },
      onError: (e) => toast.error(e.message),
    });
  };

  const handlePublish = (versionId: string) => {
    publishVersionMutation.mutate(versionId, {
      onSuccess: () => toast.success('Version published'),
      onError: (e) => toast.error(e.message),
    });
  };

  if (isLoading) {
    return <div className="p-6 space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-96 w-full max-w-3xl" /></div>;
  }

  if (!config) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Job not found.</p>
        <Link href="/transcription/jobs" className={buttonVariants({ variant: 'link' }) + ' px-0'}>Back to Jobs</Link>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          render={<Link href={`/transcription/jobs/${id}`} aria-label="Back to job" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <AudioLines className="h-5 w-5" />
        <h2 className="text-2xl font-bold tracking-tight">{config.name}</h2>
        <Badge variant="outline" className="capitalize">{config.status}</Badge>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          render={<Link href={`/transcription/jobs/${id}/playground`} aria-label="Open playground" />}
        >
          <Play className="h-4 w-4 mr-1" />
          Playground
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          render={<Link href={`/transcription/jobs/${id}`} aria-label="Job overview" />}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue={defaultTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="configure"><Settings className="h-4 w-4 mr-2" />Configuration</TabsTrigger>
          <TabsTrigger value="versions"><GitBranch className="h-4 w-4 mr-2" />Versions</TabsTrigger>
          <TabsTrigger value="keys"><KeyRound className="h-4 w-4 mr-2" />API Keys</TabsTrigger>
        </TabsList>

        <TabsContent value="configure">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>Configure the provider and default transcription settings for this job.</CardDescription>
            </CardHeader>
            <CardContent>
              <JobConfigureForm config={config} onUpdate={handleUpdate} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="versions">
          <Card>
            <CardHeader>
              <CardTitle>Version History</CardTitle>
              <CardDescription>Snapshots capture the job configuration. Publish a version to make it active.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex gap-2">
                <div className="flex-1 grid gap-1.5">
                  <Label>Change Notes</Label>
                  <Input value={changeNotes} onChange={(e) => setChangeNotes(e.target.value)} placeholder="e.g., Changed language hint to Spanish" />
                </div>
                <Button onClick={handleCreateSnapshot} disabled={createVersionMutation.isPending} className="self-end">
                  {createVersionMutation.isPending ? 'Creating...' : 'Create Snapshot'}
                </Button>
              </div>
              <Separator />
              {versionsLoading ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : !versions?.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">No snapshots yet.</p>
              ) : (
                <div className="space-y-2">
                  {versions.map((v) => {
                    const isActive = v.id === config.versionId;
                    return (
                      <div key={v.id} className={`flex items-center justify-between rounded-lg border p-3 ${isActive ? 'border-green-300 bg-green-50 dark:bg-green-950/20' : ''}`}>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium">v{v.version}</span>
                            <Badge variant={STATUS_COLORS[v.status] as 'secondary' | 'default' | 'outline' | null | undefined ?? 'secondary'} className="text-xs">{v.status}</Badge>
                            {isActive && <Badge className="text-xs bg-green-600 hover:bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Active</Badge>}
                          </div>
                          {v.changeNotes && <p className="text-xs text-muted-foreground mt-0.5">{v.changeNotes}</p>}
                          <p className="text-xs text-muted-foreground mt-0.5"><Clock className="inline h-3 w-3 mr-1" />{format(new Date(v.createdAt), 'MMM d, yyyy HH:mm')}</p>
                        </div>
                        {v.status === 'draft' && !isActive && (
                          <Button size="sm" variant="outline" onClick={() => handlePublish(v.id)} disabled={publishVersionMutation.isPending}>
                            <Upload className="h-3.5 w-3.5 mr-1.5" />Publish
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="keys">
          <JobApiKeysPanel jobConfigId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function JobConfigureForm({ config, onUpdate }: { config: TranscriptionJobConfig; onUpdate: (u: UpdateJobConfigInput) => void }) {
  const { data: providers } = useTranscriptionProviders();
  const [form, setForm] = useState({
    name: config.name,
    description: config.description ?? '',
    modelId: config.modelId ?? '',
    language: ((config.config?.language) as string) ?? '',
    diarize: Boolean(config.config?.diarize),
  });

  const save = () => {
    onUpdate({
      name: form.name,
      description: form.description,
      modelId: form.modelId || null,
      config: {
        language: form.language || undefined,
        diarize: form.diarize,
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-1.5">
        <Label>Name</Label>
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </div>
      <div className="grid gap-1.5">
        <Label>Description</Label>
        <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      </div>
      <div className="grid gap-1.5">
        <Label>Provider / Model</Label>
        <Select value={form.modelId} onValueChange={(v) => setForm((f) => ({ ...f, modelId: v }))}>
          <SelectTrigger><SelectValue placeholder="Select a provider" /></SelectTrigger>
          <SelectContent>
            {providers?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} {p.modelId ? `— ${p.modelId}` : ''}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label>Default language hint</Label>
        <Input value={form.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))} placeholder="e.g., en" />
      </div>
      <div className="flex items-center gap-3">
        <Switch id="diarize" checked={form.diarize} onCheckedChange={(v) => setForm((f) => ({ ...f, diarize: v }))} />
        <Label htmlFor="diarize">Identify speakers (diarize)</Label>
      </div>
      <Button onClick={save}>Save Changes</Button>
    </div>
  );
}

'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  useTranscriptionJobConfig,
  useTestTranscriptionJobConfig,
  useUpdateTranscriptionJobConfig,
  useTranscriptionJobConfigVersions,
  useCreateTranscriptionJobConfigVersion,
  type PlaygroundTestSegment,
} from '@/hooks/use-transcription-job-configs';
import { useTranscriptionProviders } from '@/hooks/use-transcription-providers';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { ArrowLeft, Upload, PlayCircle, Loader2, Save } from 'lucide-react';

interface TestResult {
  text: string;
  language: string | null;
  durationSec: number | null;
  segments: PlaygroundTestSegment[] | null;
}

export default function JobPlaygroundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: config, isLoading } = useTranscriptionJobConfig(id);
  const { data: versions } = useTranscriptionJobConfigVersions(id);
  const { data: providers } = useTranscriptionProviders();
  const testMutation = useTestTranscriptionJobConfig(id);
  const updateMutation = useUpdateTranscriptionJobConfig(id);
  const createVersionMutation = useCreateTranscriptionJobConfigVersion(id);

  const [versionValue, setVersionValue] = useState('current');
  const [modelId, setModelId] = useState('');
  const [language, setLanguage] = useState('');
  const [diarize, setDiarize] = useState(false);
  const [changeNotes, setChangeNotes] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load the selected version's (or the live config's) settings into the override fields.
  useEffect(() => {
    if (!config) return;
    if (versionValue === 'current') {
      setModelId(config.modelId ?? '');
      setLanguage((config.config?.language as string) ?? '');
      setDiarize(Boolean(config.config?.diarize));
      return;
    }
    const versionId = versionValue.replace('version:', '');
    const version = versions?.find((v) => v.id === versionId);
    if (!version) return;
    const snapshot = version.config as { modelId?: string | null; config?: { language?: string; diarize?: boolean } };
    setModelId(snapshot.modelId ?? '');
    setLanguage(snapshot.config?.language ?? '');
    setDiarize(Boolean(snapshot.config?.diarize));
  }, [versionValue, config, versions]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const handleTest = async () => {
    if (!file) return;
    setResult(null);
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    testMutation.mutate(
      { audioBase64: base64, mimeType: file.type || 'audio/mpeg', fileName: file.name, modelId: modelId || undefined, language: language || undefined, diarize },
      {
        onSuccess: (data) => { setResult(data); toast.success('Transcription complete'); },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  const handleCreateSnapshot = async () => {
    try {
      await updateMutation.mutateAsync({
        modelId: modelId || null,
        config: { language: language || undefined, diarize },
      });
      await createVersionMutation.mutateAsync(changeNotes || undefined);
      setChangeNotes('');
      setVersionValue('current');
      toast.success('Snapshot created from these settings');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create snapshot');
    }
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

  const selectedProvider = providers?.find((p) => p.id === modelId);

  return (
    <div className="space-y-6 p-6 max-w-3xl">
      <div className="space-y-1">
        <Link href={`/transcription/jobs/${id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' }) + ' -ml-2'}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back to Job
        </Link>
        <div className="flex items-center gap-3">
          <PlayCircle className="h-6 w-6" />
          <h2 className="text-3xl font-bold tracking-tight">{config.name} — Playground</h2>
        </div>
        <p className="text-sm text-muted-foreground">Test this job with an audio file. Change settings below without saving, or create a snapshot to keep them.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Test Settings</CardTitle>
          <CardDescription>Overrides here only apply to test runs until you create a snapshot.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label>Version</Label>
            <Select value={versionValue} onValueChange={setVersionValue}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="current">Current (live config)</SelectItem>
                {versions?.map((v) => (
                  <SelectItem key={v.id} value={`version:${v.id}`}>
                    v{v.version} ({v.status}){v.changeNotes ? ` — ${v.changeNotes}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Provider / Model</Label>
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger><SelectValue placeholder="Select a provider" /></SelectTrigger>
              <SelectContent>
                {providers?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} {p.modelId ? `— ${p.modelId}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedProvider && <p className="text-xs text-muted-foreground">Type: {selectedProvider.providerType}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label>Language hint</Label>
            <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g., en (leave blank for auto-detect)" />
          </div>

          <div className="flex items-center gap-3">
            <Switch id="diarize" checked={diarize} onCheckedChange={setDiarize} />
            <Label htmlFor="diarize">Identify speakers (diarize)</Label>
          </div>

          <Separator />

          <div className="flex items-end gap-2">
            <div className="flex-1 grid gap-1.5">
              <Label>Change Notes</Label>
              <Input value={changeNotes} onChange={(e) => setChangeNotes(e.target.value)} placeholder="e.g., Switched to vLLM, added diarization" />
            </div>
            <Button variant="outline" onClick={handleCreateSnapshot} disabled={updateMutation.isPending || createVersionMutation.isPending}>
              <Save className="h-4 w-4 mr-2" />
              {updateMutation.isPending || createVersionMutation.isPending ? 'Saving...' : 'Create Snapshot'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Upload Audio</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <input type="file" accept="audio/*" ref={inputRef} onChange={handleFile} className="hidden" />
          <div
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-muted/50 transition-colors"
          >
            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            {file ? (
              <div className="space-y-1">
                <p className="font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Click to select an audio file</p>
            )}
          </div>
          <Button onClick={handleTest} disabled={!file || testMutation.isPending}>
            {testMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Transcribing...</> : <>Test Transcription</>}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Result <Badge variant="outline">{result.language ?? 'unknown'}</Badge></CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.durationSec !== null && <p className="text-sm text-muted-foreground">Duration: {result.durationSec.toFixed(1)}s</p>}
            {result.segments && result.segments.length > 0 ? (
              <div className="bg-muted rounded p-4 text-sm space-y-1.5 max-h-80 overflow-y-auto">
                {result.segments.map((seg, i) => (
                  <p key={i} className="leading-relaxed">
                    {seg.speaker && <span className="font-medium">{seg.speaker}: </span>}
                    {seg.text}
                  </p>
                ))}
              </div>
            ) : (
              <div className="bg-muted rounded p-4 text-sm whitespace-pre-wrap leading-relaxed">{result.text}</div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

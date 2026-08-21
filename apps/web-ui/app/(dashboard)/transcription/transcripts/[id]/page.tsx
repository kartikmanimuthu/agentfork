'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft } from 'lucide-react';

interface Job {
  id: string;
  source: string;
  status: string;
  /** The caller-facing upload identifier — what the customer references in support requests. */
  uploadId: string | null;
  upload: { id: string; clientReference: string | null } | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSec: number | null;
  s3Bucket: string | null;
  s3Key: string | null;
  inputS3Key: string | null;
  outputS3Key: string | null;
  providerVersionId: string | null;
  transcript: string | null;
  language: string | null;
  output: {
    segments?: Array<{ start?: number; end?: number; speaker?: string; text: string }> | null;
    languageDetected?: boolean;
    languageDetectionConfidence?: number;
  } | null;
  error: string | null;
  latencyMs: number | null;
  webhookStatus: string | null;
  webhookAttempts: number;
  createdAt: string;
  completedAt: string | null;
  /** Presigned, short-lived — generated fresh on each fetch of this job, never stored. */
  inputAudioUrl: string | null;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right break-all">{value}</span>
    </div>
  );
}

export default function TranscriptionTranscriptsDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const { data: job, isLoading } = useQuery({
    queryKey: ['transcription-job', id],
    queryFn: async () => {
      const res = await fetch(`/api/transcription/jobs/${id}`);
      if (!res.ok) throw new Error('Failed to fetch job');
      return res.json() as Promise<Job>;
    },
  });

  const statusVariant = (s?: string): 'default' | 'secondary' | 'destructive' => {
    if (s === 'completed') return 'default';
    if (s === 'failed') return 'destructive';
    return 'secondary';
  };

  return (
    <div className="space-y-6 p-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/transcription/transcripts')} className="-ml-2">
        <ChevronLeft className="h-4 w-4 mr-1" /> Back to transcripts
      </Button>

      {isLoading || !job ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight font-mono">{job.id}</h2>
            <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
              <CardContent>
                <Row label="Source" value={<Badge variant="secondary" className="uppercase text-[10px]">{job.source}</Badge>} />
                {job.uploadId && <Row label="Upload ID" value={<span className="font-mono text-xs">{job.uploadId}</span>} />}
                {job.upload?.clientReference && (
                  <Row label="Client reference" value={<span className="font-mono text-xs">{job.upload.clientReference}</span>} />
                )}
                <Row label="File" value={job.fileName ?? '—'} />
                <Row label="MIME type" value={job.mimeType ?? '—'} />
                <Row label="Size" value={job.sizeBytes ? `${(job.sizeBytes / 1024).toFixed(1)} KB` : '—'} />
                <Row label="Duration" value={job.durationSec ? `${job.durationSec.toFixed(1)} s` : '—'} />
                <Row label="Language" value={job.language ?? '—'} />
                {job.source === 's3' && <Row label="Caller S3" value={`s3://${job.s3Bucket}/${job.s3Key}`} />}
                {job.inputS3Key && <Row label="Input (our S3)" value={job.inputS3Key} />}
                {job.outputS3Key && <Row label="Output (our S3)" value={job.outputS3Key} />}
                {job.providerVersionId && <Row label="Model version" value={job.providerVersionId} />}
                <Row label="Latency" value={job.latencyMs ? `${job.latencyMs} ms` : '—'} />
                <Row label="Webhook" value={job.webhookStatus ? `${job.webhookStatus} (${job.webhookAttempts} attempt${job.webhookAttempts === 1 ? '' : 's'})` : '—'} />
                <Row label="Created" value={new Date(job.createdAt).toLocaleString()} />
                {job.completedAt && <Row label="Completed" value={new Date(job.completedAt).toLocaleString()} />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Transcript</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {job.inputAudioUrl ? (
                  <audio controls preload="none" className="w-full" src={job.inputAudioUrl}>
                    Your browser does not support the audio element.
                  </audio>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Audio unavailable for this job.</p>
                )}
                {job.error ? (
                  <p className="text-sm text-destructive whitespace-pre-wrap max-h-96 overflow-y-auto">{job.error}</p>
                ) : job.output?.segments && job.output.segments.length > 0 ? (
                  <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                    {job.output.segments.map((seg, i) => (
                      <p key={i} className="text-sm leading-relaxed">
                        {seg.speaker && <span className="font-medium">{seg.speaker}: </span>}
                        {seg.text}
                      </p>
                    ))}
                  </div>
                ) : job.transcript ? (
                  <p className="text-sm whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">{job.transcript}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">No transcript.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

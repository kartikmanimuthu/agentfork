'use client';

import { useState } from 'react';
import { Copy, Check, Code2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative mt-2">
      <pre className="h-72 bg-zinc-950 text-zinc-100 rounded-md p-4 text-xs font-mono overflow-y-auto overflow-x-auto leading-relaxed whitespace-pre-wrap">
        <code>{code}</code>
      </pre>
      <Button
        size="sm"
        variant="ghost"
        className="absolute top-2 right-2 h-7 w-7 p-0 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
        onClick={handleCopy}
        aria-label="Copy code"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

interface TranscriptionApiGuideContentProps {
  rawKey?: string;
  showKeyInput?: boolean;
  webhookUrl?: string;
}

/** Presign/Upload/Transcribe/Retrieve/Webhook curl+guide tabs. Usable inline (no dialog) or inside a Dialog. */
export function TranscriptionApiGuideContent({ rawKey, showKeyInput = true, webhookUrl }: TranscriptionApiGuideContentProps) {
  const [editableKey, setEditableKey] = useState(rawKey ?? '');
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-app.com';
  const key = (showKeyInput ? editableKey : rawKey) || 'YOUR_API_KEY';
  const exampleWebhookUrl = webhookUrl || 'https://you.example.com/hooks/transcription';

  const presignSnippet = `# Step 1 — ask for a place to upload. Returns an uploadId (your stable
# identifier) plus a presigned POST policy for uploading straight to S3.
curl -X POST ${baseUrl}/api/v1/transcription/get-presigned-url \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "fileName": "call-recording.wav",
    "mimeType": "audio/wav",
    "clientReference": "recording_8891"
  }'

# → 201
# {
#   "uploadId": "cmsx7f2k0000v8abcd1234ef",   <- keep this; it identifies the file everywhere
#   "url": "https://<bucket>.s3.<region>.amazonaws.com/",
#   "fields": { "key": "...", "Content-Type": "audio/wav", "Policy": "...",
#               "X-Amz-Signature": "...", "success_action_status": "201", ... },
#   "expiresAt": "...", "maxBytes": 52428800, "clientReference": "recording_8891"
# }

# mimeType must be MP3 or WAV. fileName and clientReference are optional.`;

  const uploadSnippet = `# Step 2 — upload the file DIRECTLY to S3. This request does not touch
# our servers, so there is nothing for us to return: S3 answers you.
# Send every field from "fields" verbatim, and put "file" LAST.
curl -X POST "https://<bucket>.s3.<region>.amazonaws.com/" \\
  -F "key=transcription/_uploads/<tenant>/<uuid>-call-recording.wav" \\
  -F "Content-Type=audio/wav" \\
  -F "bucket=<bucket>" \\
  -F "X-Amz-Algorithm=AWS4-HMAC-SHA256" \\
  -F "X-Amz-Credential=..." \\
  -F "X-Amz-Date=..." \\
  -F "X-Amz-Security-Token=..." \\
  -F "Policy=..." \\
  -F "X-Amz-Signature=..." \\
  -F "success_action_status=201" \\
  -F "file=@./call-recording.wav"

# → 201 Created  (with <PostResponse><Bucket/><Key/><ETag/></PostResponse>)
#   That 201 is your confirmation the upload landed. No need to tell us.
#
# → 400 EntityTooLarge   file exceeded the size cap (enforced by S3)
# → 400 EntityTooSmall   empty file
# → 403 AccessDenied     Content-Type didn't match, or the policy expired
#
# Rules: "file" must be the last field, send all fields unchanged, add none.`;

  const transcribeSnippet = `# Step 3 — transcribe. Just the uploadId; no file, no S3 key.
curl -X POST ${baseUrl}/api/v1/transcription \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "uploadId": "cmsx7f2k0000v8abcd1234ef",
    "sync": false,
    "diarize": true,
    "webhookUrl": "${exampleWebhookUrl}"
  }'

# async (sync:false) → 202
# { "transcriptionId": "...", "uploadId": "cmsx7f2k...", "clientReference": "recording_8891",
#   "status": "queued", "statusUrl": "/api/v1/transcription/jobs/..." }
#   ...the transcript arrives on your webhook, carrying the same uploadId.

# sync (sync:true) → 200 with the transcript inline. Short clips only —
# the connection stays open for the whole transcription.

# language omitted -> auto-detected. Pass "language": "hi" (etc., 22 Indian languages — no English) to skip detection.
# Calling again with the same uploadId returns the existing job (safe to retry).`;

  const retrieveSnippet = `# Step 4 (optional) — fetch the transcript any time later.
curl "${baseUrl}/api/v1/transcription/transcripts?uploadId=cmsx7f2k0000v8abcd1234ef" \\
  -H "Authorization: Bearer ${key}"

# → 200
# {
#   "transcriptionId": "...", "uploadId": "cmsx7f2k...",
#   "clientReference": "recording_8891", "status": "completed",
#   "language": "en", "durationSec": 54.9,
#   "transcript": "...", "segments": [ { "start": 0.03, "end": 3.2,
#                                       "speaker": "Speaker 1", "text": "..." } ]
# }

# Very large transcripts come back as "transcriptUrl" (a short-lived link) with
# "transcript": null, instead of being inlined.

# You can also look up by job id:
curl "${baseUrl}/api/v1/transcription/transcripts?transcriptionId=job_..." \\
  -H "Authorization: Bearer ${key}"

# Only your own tenant's transcripts are visible; anything else returns 404.`;

  const webhookVerifySnippet = `// Node.js / Express
const crypto = require('crypto');

app.post('/hooks/transcription', express.json(), (req, res) => {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  const expected = Buffer.from(process.env.WEBHOOK_SECRET);
  const got = Buffer.from(token);
  const ok = expected.length === got.length && crypto.timingSafeEqual(expected, got);
  if (!ok) return res.status(401).send('bad token');

  const event = req.body;
  // event.uploadId          <- same value the presign call returned
  // event.clientReference   <- your own reference, echoed back
  // event.status            <- "completed" | "failed"
  // event.output?.text, event.output?.segments, or event.error
  res.status(200).send('ok'); // ack fast, process async
});`;

  return (
    <div className="space-y-3">
      {showKeyInput && (
        <div className="grid gap-1.5">
          <Label htmlFor="transcription-api-key-input" className="text-sm">API Key</Label>
          <Input
            id="transcription-api-key-input"
            className="font-mono text-xs"
            placeholder="Paste your API key here to populate the snippets"
            value={editableKey}
            onChange={(e) => setEditableKey(e.target.value)}
          />
        </div>
      )}

      <Tabs defaultValue="presign">
        <TabsList className="gap-1">
          <TabsTrigger value="presign" className="px-3">1 · Presign</TabsTrigger>
          <TabsTrigger value="upload" className="px-3">2 · Upload</TabsTrigger>
          <TabsTrigger value="transcribe" className="px-3">3 · Transcribe</TabsTrigger>
          <TabsTrigger value="retrieve" className="px-3">4 · Retrieve</TabsTrigger>
          <TabsTrigger value="webhook" className="px-3">Webhook</TabsTrigger>
        </TabsList>
        <TabsContent value="presign" className="h-80 overflow-y-auto pr-1">
          <CodeBlock code={presignSnippet} />
        </TabsContent>
        <TabsContent value="upload" className="h-80 overflow-y-auto pr-1">
          <CodeBlock code={uploadSnippet} />
        </TabsContent>
        <TabsContent value="transcribe" className="h-80 overflow-y-auto pr-1">
          <CodeBlock code={transcribeSnippet} />
        </TabsContent>
        <TabsContent value="retrieve" className="h-80 overflow-y-auto pr-1">
          <CodeBlock code={retrieveSnippet} />
        </TabsContent>
        <TabsContent value="webhook" className="h-80 overflow-y-auto pr-1 space-y-2">
          <div className="text-xs text-muted-foreground space-y-2">
            <p>Every webhook delivery for this key carries <code className="font-mono">Authorization: Bearer &lt;secret&gt;</code> — a static token, not a signature. To register/verify it on your own server:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Generate the secret once (<em>Generate Secret</em> button on this key) and save it on your server — e.g. as a <code className="font-mono">WEBHOOK_SECRET</code> env variable. This is the only "registration" step; there's nothing to configure on our side beyond that.</li>
              <li>On every request your webhook endpoint receives, read the <code className="font-mono">Authorization</code> header and strip the <code className="font-mono">Bearer </code> prefix.</li>
              <li>Compare it to your stored secret (constant-time). Match → trust the payload. No match → reject with <code className="font-mono">401</code>.</li>
            </ol>
          </div>
          <CodeBlock code={webhookVerifySnippet} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface TranscriptionApiGuideDialogProps {
  keyName: string;
  rawKey?: string;
  webhookUrl?: string;
  trigger?: React.ReactNode;
}

export function TranscriptionApiGuideDialog({ keyName, rawKey, webhookUrl, trigger }: TranscriptionApiGuideDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <span onClick={() => setOpen(true)}>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Code2 className="h-4 w-4 mr-2" />
            Integration Guide
          </Button>
        )}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Integration Guide — {keyName}</DialogTitle>
          </DialogHeader>
          <TranscriptionApiGuideContent rawKey={rawKey} webhookUrl={webhookUrl} />
        </DialogContent>
      </Dialog>
    </>
  );
}

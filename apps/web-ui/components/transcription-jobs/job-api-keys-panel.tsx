'use client';

import { useState } from 'react';
import {
  useTranscriptionApiKeys,
  useCreateTranscriptionApiKey,
  useRevokeTranscriptionApiKey,
  useWebhookSecretStatus,
  useRotateWebhookSecret,
  type TranscriptionApiKey,
} from '@/hooks/use-transcription-api-keys';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { KeyRound, ShieldCheck, RotateCw, Copy, CheckCircle2, Code2 } from 'lucide-react';
import { TranscriptionApiGuideDialog, TranscriptionApiGuideContent } from '@/components/transcription-jobs/transcription-api-guide-dialog';

export function JobApiKeysPanel({ jobConfigId }: { jobConfigId: string }) {
  const { data: keys, isLoading } = useTranscriptionApiKeys(jobConfigId);
  const createMutation = useCreateTranscriptionApiKey();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [newKeyWebhookUrl, setNewKeyWebhookUrl] = useState<string | undefined>(undefined);
  const [form, setForm] = useState({ name: '', webhookUrl: '', dailyReqLimit: '1000', dailyMinutesLimit: '600', minuteReqLimit: '100' });

  const handleCreate = () => {
    const webhookUrl = form.webhookUrl || undefined;
    createMutation.mutate({
      name: form.name,
      jobConfigId,
      webhookUrl,
      dailyReqLimit: Number(form.dailyReqLimit),
      dailyMinutesLimit: Number(form.dailyMinutesLimit),
      minuteReqLimit: Number(form.minuteReqLimit),
    }, {
      onSuccess: (data) => {
        setNewKey(data.rawKey);
        setNewKeyWebhookUrl(webhookUrl);
        setForm({ name: '', webhookUrl: '', dailyReqLimit: '1000', dailyMinutesLimit: '600', minuteReqLimit: '100' });
        toast.success('API key created');
      },
      onError: (e) => toast.error(e.message),
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" />Create API Key</CardTitle>
          <CardDescription>API keys are scoped to this job. They include webhook secrets and rate limits.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Production key" />
          </div>
          <div className="grid gap-1.5">
            <Label>Webhook URL</Label>
            <Input value={form.webhookUrl} onChange={(e) => setForm((f) => ({ ...f, webhookUrl: e.target.value }))} placeholder="https://your-app.com/webhook" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>Daily requests</Label>
              <Input value={form.dailyReqLimit} onChange={(e) => setForm((f) => ({ ...f, dailyReqLimit: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Daily minutes</Label>
              <Input value={form.dailyMinutesLimit} onChange={(e) => setForm((f) => ({ ...f, dailyMinutesLimit: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Minute requests</Label>
              <Input value={form.minuteReqLimit} onChange={(e) => setForm((f) => ({ ...f, minuteReqLimit: e.target.value }))} />
            </div>
          </div>
          <Button onClick={handleCreate} disabled={!form.name.trim() || createMutation.isPending}>
            {createMutation.isPending ? 'Creating...' : 'Create API Key'}
          </Button>
        </CardContent>
      </Card>

      {isLoading ? <Skeleton className="h-32 w-full" /> : (
        <div className="space-y-3">
          {keys?.map((k) => <ApiKeyCard key={k.id} apiKey={k} />)}
          {!keys?.length && <p className="text-sm text-muted-foreground">No API keys for this job yet.</p>}
        </div>
      )}

      <Dialog open={!!newKey} onOpenChange={() => { setNewKey(null); setNewKeyWebhookUrl(undefined); }}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />API Key Created</DialogTitle>
            <DialogDescription>Copy this key now — it will <strong>not</strong> be shown again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted rounded px-3 py-2 font-mono break-all select-all">{newKey}</code>
              <CopyButton text={newKey ?? ''} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-sm">API curl examples</Label>
              <TranscriptionApiGuideContent rawKey={newKey ?? undefined} showKeyInput={false} webhookUrl={newKeyWebhookUrl} />
            </div>
            <Button className="w-full" onClick={() => { setNewKey(null); setNewKeyWebhookUrl(undefined); }}>Done — I have saved it</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApiKeyCard({ apiKey }: { apiKey: TranscriptionApiKey }) {
  const revokeMutation = useRevokeTranscriptionApiKey();
  const { data: secretStatus, isLoading: statusLoading } = useWebhookSecretStatus(apiKey.id);
  const rotateMutation = useRotateWebhookSecret();
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [showSecretDialog, setShowSecretDialog] = useState(false);

  const handleRotate = () => {
    rotateMutation.mutate(apiKey.id, {
      onSuccess: (data) => { setRevealedSecret(data.rawSecret); setShowSecretDialog(true); },
      onError: (e) => toast.error(e.message),
    });
  };

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{apiKey.name}</span>
                <Badge variant={apiKey.status === 'active' ? 'default' : 'secondary'} className="text-xs">{apiKey.status}</Badge>
              </div>
              <p className="text-xs font-mono text-muted-foreground mt-0.5">{apiKey.keyPrefix}•••</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {statusLoading ? <Skeleton className="h-5 w-20" /> : secretStatus?.hasSecret ? (
                <Badge variant="outline" className="text-green-700 border-green-300 text-xs"><ShieldCheck className="h-3 w-3 mr-1" />Secret set</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground text-xs">No secret</Badge>
              )}
              <TranscriptionApiGuideDialog
                keyName={apiKey.name}
                webhookUrl={apiKey.webhookUrl ?? undefined}
                trigger={
                  <Button variant="ghost" size="sm" aria-label="View integration guide">
                    <Code2 className="h-4 w-4" />
                  </Button>
                }
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleRotate}
                disabled={rotateMutation.isPending || apiKey.status !== 'active' || !apiKey.webhookUrl}
                title={!apiKey.webhookUrl ? 'Set a webhook URL on this key before generating a secret — there is nothing to send it to otherwise' : undefined}
              >
                <RotateCw className="h-3.5 w-3.5 mr-1.5" />
                {rotateMutation.isPending ? 'Rotating...' : secretStatus?.hasSecret ? 'Rotate Secret' : 'Generate Secret'}
              </Button>
            </div>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Webhook URL</Label>
            <p className="text-xs font-mono text-muted-foreground bg-muted rounded px-2 py-1.5 break-all">{apiKey.webhookUrl ?? <span className="italic">Not configured</span>}</p>
            {!apiKey.webhookUrl && (
              <p className="text-xs text-muted-foreground">Set a webhook URL when creating a key to enable secret generation — there's nothing to send it to otherwise.</p>
            )}
          </div>
          {secretStatus?.hasSecret && secretStatus.hint && (
            <p className="text-xs font-mono text-muted-foreground">Hint: {secretStatus.hint}</p>
          )}
          {secretStatus?.hasSecret && (
            <div className="rounded-md bg-muted/50 border p-2.5 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Setting this up on your server</p>
              <p>
                Every webhook delivery carries <code className="font-mono">Authorization: Bearer &lt;secret&gt;</code>. Save the secret
                you copied when it was generated (e.g. as a <code className="font-mono">WEBHOOK_SECRET</code> env variable), then on
                each incoming request compare it against the <code className="font-mono">Authorization</code> header — reject anything
                that doesn&apos;t match. That&apos;s the entire registration step; nothing else needs configuring on our side. Open the
                Integration Guide above (<span className="font-medium">Webhook</span> tab) for a copy-paste code example.
              </p>
            </div>
          )}
          {apiKey.status === 'active' && (
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => revokeMutation.mutate(apiKey.id, { onSuccess: () => toast.success('Key revoked') })} disabled={revokeMutation.isPending}>
              Revoke
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={showSecretDialog} onOpenChange={setShowSecretDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-green-600" />Webhook Secret Generated</DialogTitle>
            <DialogDescription>Copy this secret now — it will <strong>not</strong> be shown again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted rounded px-3 py-2 font-mono break-all select-all">{revealedSecret}</code>
              <CopyButton text={revealedSecret ?? ''} />
            </div>
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-200 space-y-1">
              <p className="font-medium">Security reminders</p>
              <ul className="list-disc list-inside space-y-0.5 text-amber-700 dark:text-amber-300">
                <li>Set as <code>WEBHOOK_SECRET</code> env variable on your server</li>
                <li>Every delivery carries <code>Authorization: Bearer &lt;secret&gt;</code> — reject requests where it doesn't match</li>
                <li>Only accept this webhook over HTTPS — the token is sent in plain text on every request</li>
              </ul>
            </div>
            <Button className="w-full" onClick={() => { setShowSecretDialog(false); setRevealedSecret(null); }}>Done — I have saved the secret</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Copied to clipboard');
  };
  return (
    <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={copy}>
      {copied ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

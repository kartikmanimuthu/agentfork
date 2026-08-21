'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, KeyRound, Copy, Ban, Webhook, RotateCw, CheckCircle2, ShieldCheck } from 'lucide-react';
import { createTranscriptionApiKeySchema } from '@chatbot/shared/client';

interface KeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  modelId: string | null;
  dailyReqLimit: number;
  dailyMinutesLimit: number;
  minuteReqLimit: number;
  webhookUrl: string | null;
  createdAt: string;
}

interface ModelRow { id: string; name: string }

interface WebhookSecretStatus {
  hasSecret: boolean;
  hint: string | null;
}

async function getWebhookSecretStatus(id: string): Promise<WebhookSecretStatus> {
  const res = await fetch(`/api/transcription/api-keys/${id}/webhook-secret`);
  if (!res.ok) throw new Error('Failed to get webhook secret status');
  return res.json();
}

async function rotateWebhookSecret(id: string): Promise<{ rawSecret: string; hasSecret: boolean }> {
  const res = await fetch(`/api/transcription/api-keys/${id}/webhook-secret`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to rotate webhook secret');
  }
  return res.json();
}

function WebhookKeyCard({ apiKey }: { apiKey: KeyRow }) {
  const qc = useQueryClient();
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [showSecretDialog, setShowSecretDialog] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: secretStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['transcription-webhook-secret-status', apiKey.id],
    queryFn: () => getWebhookSecretStatus(apiKey.id),
    enabled: apiKey.status === 'active',
  });

  const rotateMutation = useMutation({
    mutationFn: () => rotateWebhookSecret(apiKey.id),
    onSuccess: (data) => {
      setRevealedSecret(data.rawSecret);
      setShowSecretDialog(true);
      qc.invalidateQueries({ queryKey: ['transcription-webhook-secret-status', apiKey.id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to rotate secret'),
  });

  const copySecret = async () => {
    if (!revealedSecret) return;
    await navigator.clipboard.writeText(revealedSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Secret copied to clipboard');
  };

  const verificationSnippet = apiKey.webhookUrl
    ? `// Node.js — verify Transcription webhook (HMAC-SHA256, v2 with replay protection)
const crypto = require('crypto');

function verifyWebhook(rawBody, signatureHeader, secret) {
  const [tPart, v1Part] = signatureHeader.split(',');
  const timestamp = tPart?.split('=')[1];
  const receivedHmac = v1Part?.split('=')[1];
  if (!timestamp || !receivedHmac) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const signedPayload = \`\${timestamp}.\${rawBody}\`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedHmac));
}

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-webhook-signature-v2'];
  if (!verifyWebhook(req.body.toString(), sig, process.env.WEBHOOK_SECRET))
    return res.status(401).send('Invalid signature');
  const event = JSON.parse(req.body);
  console.log('Job completed:', event.jobId, event.status);
  res.sendStatus(200);
});`
    : '';

  return (
    <>
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{apiKey.name}</span>
              <Badge variant={apiKey.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                {apiKey.status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{apiKey.keyPrefix}•••</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {statusLoading ? (
              <Skeleton className="h-5 w-20" />
            ) : secretStatus?.hasSecret ? (
              <Badge variant="outline" className="text-green-700 border-green-300 text-xs">
                <ShieldCheck className="h-3 w-3 mr-1" />Secret set
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground text-xs">No secret</Badge>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => rotateMutation.mutate()}
              disabled={rotateMutation.isPending || apiKey.status !== 'active'}
            >
              <RotateCw className="h-3.5 w-3.5 mr-1.5" />
              {rotateMutation.isPending ? 'Rotating...' : secretStatus?.hasSecret ? 'Rotate Secret' : 'Generate Secret'}
            </Button>
          </div>
        </div>

        <div className="grid gap-1">
          <Label className="text-xs">Webhook URL</Label>
          <p className="text-xs font-mono text-muted-foreground bg-muted rounded px-2 py-1.5 break-all">
            {apiKey.webhookUrl ?? <span className="italic">Not configured — set a webhook URL when creating this key</span>}
          </p>
        </div>

        {secretStatus?.hasSecret && secretStatus.hint && (
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Secret hint</Label>
            <p className="text-xs font-mono text-muted-foreground">{secretStatus.hint}</p>
          </div>
        )}

        {apiKey.webhookUrl && verificationSnippet && (
          <details className="group">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
              Show Node.js verification snippet
            </summary>
            <pre className="mt-2 text-xs bg-muted rounded p-3 overflow-x-auto whitespace-pre leading-relaxed">
              {verificationSnippet}
            </pre>
          </details>
        )}
      </div>

      <Dialog open={showSecretDialog} onOpenChange={setShowSecretDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-green-600" />
              Webhook Secret Generated
            </DialogTitle>
            <DialogDescription>
              Copy this secret now — it will <strong>not</strong> be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted rounded px-3 py-2 font-mono break-all select-all">
                {revealedSecret}
              </code>
              <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={copySecret}>
                {copied ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-200 space-y-1">
              <p className="font-medium">Security reminders</p>
              <ul className="list-disc list-inside space-y-0.5 text-amber-700 dark:text-amber-300">
                <li>Set as <code>WEBHOOK_SECRET</code> env variable on your server</li>
                <li>Verify <code>X-Webhook-Signature-V2</code> on every request</li>
                <li>Reject requests older than 5 minutes (replay protection)</li>
              </ul>
            </div>
            <Button className="w-full" onClick={() => { setShowSecretDialog(false); setRevealedSecret(null); }}>
              Done — I&apos;ve saved the secret
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const emptyForm = { name: '', modelId: 'default', dailyReqLimit: '1000', dailyMinutesLimit: '600', minuteReqLimit: '100', webhookUrl: '' };

export default function TranscriptionApiKeysPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [newKey, setNewKey] = useState<string | null>(null);

  const { data: keys, isLoading } = useQuery({
    queryKey: ['transcription-api-keys'],
    queryFn: async () => {
      const res = await fetch('/api/transcription/api-keys');
      if (!res.ok) throw new Error('Failed to fetch keys');
      return res.json() as Promise<KeyRow[]>;
    },
  });

  const { data: models } = useQuery({
    queryKey: ['transcription-models'],
    queryFn: async () => {
      const res = await fetch('/api/transcription/models');
      if (!res.ok) return [] as ModelRow[];
      return res.json() as Promise<ModelRow[]>;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        modelId: form.modelId === 'default' ? undefined : form.modelId,
        dailyReqLimit: Number(form.dailyReqLimit),
        dailyMinutesLimit: Number(form.dailyMinutesLimit),
        minuteReqLimit: Number(form.minuteReqLimit),
        webhookUrl: form.webhookUrl || undefined,
      };
      const parsed = createTranscriptionApiKeySchema.safeParse(payload);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid input');
      const res = await fetch('/api/transcription/api-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to create key');
      return res.json() as Promise<{ rawKey: string }>;
    },
    onSuccess: (data) => {
      setNewKey(data.rawKey);
      qc.invalidateQueries({ queryKey: ['transcription-api-keys'] });
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/transcription/api-keys/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Failed to revoke');
    },
    onSuccess: () => { toast.success('Key revoked'); qc.invalidateQueries({ queryKey: ['transcription-api-keys'] }); },
    onError: () => toast.error('Failed to revoke key'),
  });

  const copy = (text: string) => { navigator.clipboard.writeText(text); toast.success('Copied to clipboard'); };

  // Resolves to wherever this page is actually served — localhost in dev,
  // the real domain once deployed — so the snippet never needs manual editing.
  const apiHost = typeof window !== 'undefined' ? window.location.origin : 'https://YOUR_HOST';

  const curlUpload = (key: string) =>
    `# Step 1 — Upload your audio file
curl -X POST ${apiHost}/api/v1/transcription/upload \\
  -H "Authorization: Bearer ${key}" \\
  -F "file=@sample.wav"

# Step 2 — Transcribe (sync, default)
curl -X POST ${apiHost}/api/v1/transcription \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"s3Key":"<s3Key from upload>","sync":true}'`;

  const curlAsync = (key: string) =>
    `# Async mode — returns job ID immediately
curl -X POST ${apiHost}/api/v1/transcription \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"s3Key":"<s3Key from upload>","sync":false,"webhookUrl":"https://your-service/webhook"}'`;

  const activeKeys = keys?.filter((k) => k.status === 'active') ?? [];

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center gap-2">
        <KeyRound className="h-6 w-6" />
        <h2 className="text-3xl font-bold tracking-tight">API Keys</h2>
      </div>
      <p className="text-muted-foreground">
        Manage API keys for the transcription API and configure HMAC webhook secrets for secure async job callbacks.
      </p>

      <Tabs defaultValue="keys">
        <TabsList>
          <TabsTrigger value="keys" className="gap-2"><KeyRound className="h-3.5 w-3.5" />API Keys</TabsTrigger>
          <TabsTrigger value="webhooks" className="gap-2"><Webhook className="h-3.5 w-3.5" />Webhook Secrets</TabsTrigger>
        </TabsList>

        {/* ── API Keys tab ── */}
        <TabsContent value="keys" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>All Keys</CardTitle>
                  <CardDescription>
                    {isLoading ? <Skeleton className="h-4 w-32" /> : `${keys?.length ?? 0} key${(keys?.length ?? 0) !== 1 ? 's' : ''}`}
                  </CardDescription>
                </div>
                <Dialog open={open} onOpenChange={setOpen}>
                  <DialogTrigger className={buttonVariants()}><Plus className="h-4 w-4 mr-2" />New Key</DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create API key</DialogTitle>
                      <DialogDescription>Set quotas and an optional webhook URL. The raw key is shown once after creation.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="name">Name</Label>
                        <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Production caller" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Model</Label>
                        <Select value={form.modelId} onValueChange={(v) => setForm((f) => ({ ...f, modelId: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">Tenant default</SelectItem>
                            {models?.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="dr" className="text-xs">Daily requests</Label>
                          <Input id="dr" type="number" value={form.dailyReqLimit} onChange={(e) => setForm((f) => ({ ...f, dailyReqLimit: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="dm" className="text-xs">Daily minutes</Label>
                          <Input id="dm" type="number" value={form.dailyMinutesLimit} onChange={(e) => setForm((f) => ({ ...f, dailyMinutesLimit: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="mr" className="text-xs">Req / min</Label>
                          <Input id="mr" type="number" value={form.minuteReqLimit} onChange={(e) => setForm((f) => ({ ...f, minuteReqLimit: e.target.value }))} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="wh">Webhook URL (optional)</Label>
                        <Input id="wh" value={form.webhookUrl} onChange={(e) => setForm((f) => ({ ...f, webhookUrl: e.target.value }))} placeholder="https://your-service/webhook" />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                      <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.name}>
                        {createMutation.isPending ? 'Creating…' : 'Create'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
              ) : keys?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No API keys yet. Create one to call the transcription API.</div>
              ) : (
                <div className="space-y-2">
                  {keys?.map((k) => (
                    <div key={k.id} className="flex items-center justify-between rounded-lg border p-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{k.name}</span>
                          <Badge variant={k.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">{k.status}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 font-mono">{k.keyPrefix}…</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {k.dailyReqLimit}/day · {k.dailyMinutesLimit} min/day · {k.minuteReqLimit}/min
                          {k.webhookUrl && <span className="ml-2 text-blue-600 dark:text-blue-400">· webhook configured</span>}
                        </div>
                      </div>
                      {k.status === 'active' && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => revokeMutation.mutate(k.id)} aria-label="Revoke">
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Webhook Secrets tab ── */}
        <TabsContent value="webhooks" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>How webhook signatures work</CardTitle>
              <CardDescription>
                When an async job completes we POST the result to your webhook URL signed with two headers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-2 text-xs font-mono bg-muted rounded p-3">
                <div><span className="text-muted-foreground">X-Webhook-Signature: </span>sha256=&lt;hmac-of-body&gt;</div>
                <div><span className="text-muted-foreground">X-Webhook-Signature-V2: </span>t=&lt;unix-timestamp&gt;,v1=&lt;hmac&gt;</div>
              </div>
              <p className="text-xs text-muted-foreground">
                Use <code className="bg-muted px-1 rounded">X-Webhook-Signature-V2</code> — it includes a timestamp for replay protection (5-minute window). HMAC is computed over <code className="bg-muted px-1 rounded">&quot;{'{'}timestamp{'}'}.{'{'}body{'}'}&quot;</code>.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Signing Secrets</CardTitle>
              <CardDescription>
                Generate or rotate the HMAC signing secret per API key. Secrets are shown only once — copy immediately.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
              ) : !activeKeys.length ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No active API keys. Create one on the <strong>API Keys</strong> tab first.
                </div>
              ) : (
                <div className="space-y-4">
                  {activeKeys.map((k) => <WebhookKeyCard key={k.id} apiKey={k} />)}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Raw key shown once after creation */}
      <Dialog open={!!newKey} onOpenChange={(o) => !o && setNewKey(null)}>
        <DialogContent className="max-w-2xl sm:max-w-2xl w-full">
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription>Copy it now — it will not be shown again.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-muted p-2">
            <code className="text-xs break-all flex-1 select-all">{newKey}</code>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => newKey && copy(newKey)}><Copy className="h-4 w-4" /></Button>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs font-medium">Upload &amp; transcribe (sync)</Label>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => newKey && copy(curlUpload(newKey))}><Copy className="h-3 w-3 mr-1" />Copy</Button>
              </div>
              <pre className="text-[11px] bg-muted rounded-md p-3 overflow-x-auto whitespace-pre leading-relaxed">{newKey && curlUpload(newKey)}</pre>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs font-medium">Async mode (background job + webhook)</Label>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => newKey && copy(curlAsync(newKey))}><Copy className="h-3 w-3 mr-1" />Copy</Button>
              </div>
              <pre className="text-[11px] bg-muted rounded-md p-3 overflow-x-auto whitespace-pre leading-relaxed">{newKey && curlAsync(newKey)}</pre>
              <p className="text-[11px] text-muted-foreground mt-1.5">Configure a webhook secret on the <strong>Webhook Secrets</strong> tab to authenticate callbacks.</p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

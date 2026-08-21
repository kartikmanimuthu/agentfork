'use client';

import { useState } from 'react';
import { Check, Copy, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { ChannelId } from '@/hooks/use-connectors';

/** Where to paste the URL, per platform. Credentials alone don't make a channel
 *  live — the platform has to be told to deliver to us. */
const REGISTRATION_STEPS: Record<ChannelId, string[]> = {
  slack: [
    'Slack app → Slash Commands → create /claw and set its Request URL to this address.',
    'Interactivity & Shortcuts → turn on and set the same Request URL, so Approve/Reject buttons work.',
    'Event Subscriptions → turn on, set the same Request URL, and subscribe to message.channels so thread replies reach Claw.',
  ],
  telegram: [
    'Register the webhook with your bot token, including the secret token so Claw can identify your tenant:',
    'curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" -d "url=<WEBHOOK_URL>" -d "secret_token=<SECRET_TOKEN>"',
  ],
  discord: [
    'Discord Developer Portal → your app → General Information → Interactions Endpoint URL → paste this address.',
    'Discord Developer Portal → your app → Slash Commands → create a /claw command with one required string option named "prompt".',
    'Discord sends a signed PING to this URL as soon as you paste it — Claw must already have valid credentials saved for that to succeed.',
  ],
};

const CHANNEL_DISPLAY_NAMES: Record<ChannelId, string> = {
  slack: 'Slack',
  telegram: 'Telegram',
  discord: 'Discord',
};

export function ConnectorWebhookCard({
  channel,
  webhookUrl,
  ready,
}: {
  channel: ChannelId;
  webhookUrl: string;
  ready: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const isLocal = /localhost|127\.0\.0\.1/.test(webhookUrl);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select the URL and copy it manually.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Webhook className="h-4 w-4" />
          Webhook URL
        </CardTitle>
        <CardDescription>
          {ready
            ? 'Register this with the platform so it delivers messages to Claw.'
            : 'Save working credentials first — until then this endpoint has nothing to route to.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input readOnly value={webhookUrl} className="font-mono text-xs" />
          <Button variant="outline" size="icon" onClick={copy} aria-label="Copy webhook URL">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        {isLocal ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-500">
            This is a localhost address, which {CHANNEL_DISPLAY_NAMES[channel]} cannot reach.
            For local testing, expose Mission Control through a tunnel and set
            NEXT_PUBLIC_MISSION_CONTROL_URL to that origin.
          </div>
        ) : null}

        <ol className="space-y-1.5 text-xs text-muted-foreground">
          {REGISTRATION_STEPS[channel].map((step) => (
            <li key={step} className={step.startsWith('curl') ? 'font-mono break-all' : ''}>
              {step.startsWith('curl') ? step.replace('<WEBHOOK_URL>', webhookUrl) : `• ${step}`}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

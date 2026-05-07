'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CreateKeyDialogProps {
  agentId: string;
  onCreate: (input: Record<string, unknown>) => Promise<unknown>;
  onSuccess: () => void;
}

export function CreateKeyDialog({ onCreate, onSuccess }: CreateKeyDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [dailyReqLimit, setDailyReqLimit] = useState('1000');
  const [dailyTokenLimit, setDailyTokenLimit] = useState('100000');
  const [minuteReqLimit, setMinuteReqLimit] = useState('100');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const input: Record<string, unknown> = {
        name,
        dailyReqLimit: parseInt(dailyReqLimit, 10),
        dailyTokenLimit: parseInt(dailyTokenLimit, 10),
        minuteReqLimit: parseInt(minuteReqLimit, 10),
      };
      if (webhookUrl.trim()) {
        input.webhookUrl = webhookUrl.trim();
      }

      const result = (await onCreate(input)) as { rawKey?: string };

      if (result.rawKey) {
        setRawKey(result.rawKey);
      }
      onSuccess();
    } catch (error) {
      console.error('Failed to create key:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setRawKey(null);
    setName('');
    setDailyReqLimit('1000');
    setDailyTokenLimit('100000');
    setMinuteReqLimit('100');
    setWebhookUrl('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create API Key</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create API Key</DialogTitle>
          <DialogDescription>
            Create a new API key for this agent. The raw key will only be shown once.
          </DialogDescription>
        </DialogHeader>

        {rawKey ? (
          <div className="space-y-4">
            <div className="rounded-md bg-muted p-4">
              <p className="text-sm font-medium mb-2">Your API Key (copy it now, it won't be shown again):</p>
              <code className="block text-sm font-mono break-all bg-background p-2 rounded border">
                {rawKey}
              </code>
            </div>
            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="Production Key"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="reqLimit">Daily Requests</Label>
                  <Input
                    id="reqLimit"
                    type="number"
                    value={dailyReqLimit}
                    onChange={(e) => setDailyReqLimit(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="tokenLimit">Daily Tokens</Label>
                  <Input
                    id="tokenLimit"
                    type="number"
                    value={dailyTokenLimit}
                    onChange={(e) => setDailyTokenLimit(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="minuteLimit">Per-Minute Requests</Label>
                <Input
                  id="minuteLimit"
                  type="number"
                  value={minuteReqLimit}
                  onChange={(e) => setMinuteReqLimit(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="webhook">Webhook URL (optional)</Label>
                <Input
                  id="webhook"
                  placeholder="https://your-app.com/webhooks/agent"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={loading || !name}>
                {loading ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

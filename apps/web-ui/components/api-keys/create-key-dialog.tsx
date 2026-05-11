'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
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

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  dailyReqLimit: z.number().int().min(0).optional(),
  dailyTokenLimit: z.number().int().min(0).optional(),
  minuteReqLimit: z.number().int().min(0).optional(),
  webhookUrl: z.string().url().optional().or(z.literal('')),
});

type CreateKeyFormValues = z.infer<typeof schema>;

interface CreateKeyDialogProps {
  agentId: string;
  onCreate: (input: Record<string, unknown>) => Promise<unknown>;
  onSuccess: () => void;
}

export function CreateKeyDialog({ onCreate, onSuccess }: CreateKeyDialogProps) {
  const [open, setOpen] = useState(false);
  const [rawKey, setRawKey] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      name: '',
      dailyReqLimit: 1000,
      dailyTokenLimit: 100000,
      minuteReqLimit: 100,
      webhookUrl: '',
    } as CreateKeyFormValues,
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      const input: Record<string, unknown> = {
        name: value.name.trim(),
        dailyReqLimit: value.dailyReqLimit,
        dailyTokenLimit: value.dailyTokenLimit,
        minuteReqLimit: value.minuteReqLimit,
      };
      if (value.webhookUrl?.trim()) {
        input.webhookUrl = value.webhookUrl.trim();
      }

      const result = (await onCreate(input)) as { rawKey?: string };

      if (result.rawKey) {
        setRawKey(result.rawKey);
      }
      onSuccess();
    },
  });

  const handleClose = () => {
    setOpen(false);
    setRawKey(null);
    form.reset();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          >
            <div className="grid gap-4 py-4">
              <form.Field name="name">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor={field.name}>Name</Label>
                    <Input
                      id={field.name}
                      placeholder="Production Key"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                    )}
                  </div>
                )}
              </form.Field>

              <div className="grid grid-cols-2 gap-4">
                <form.Field name="dailyReqLimit">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label htmlFor={field.name}>Daily Requests</Label>
                      <Input
                        id={field.name}
                        type="number"
                        min={0}
                        value={field.state.value ?? ''}
                        onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : 0)}
                        onBlur={field.handleBlur}
                      />
                    </div>
                  )}
                </form.Field>

                <form.Field name="dailyTokenLimit">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label htmlFor={field.name}>Daily Tokens</Label>
                      <Input
                        id={field.name}
                        type="number"
                        min={0}
                        value={field.state.value ?? ''}
                        onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : 0)}
                        onBlur={field.handleBlur}
                      />
                    </div>
                  )}
                </form.Field>
              </div>

              <form.Field name="minuteReqLimit">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor={field.name}>Per-Minute Requests</Label>
                    <Input
                      id={field.name}
                      type="number"
                      min={0}
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : 0)}
                      onBlur={field.handleBlur}
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="webhookUrl">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor={field.name}>Webhook URL (optional)</Label>
                    <Input
                      id={field.name}
                      placeholder="https://your-app.com/webhooks/agent"
                      value={field.state.value ?? ''}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                    )}
                  </div>
                )}
              </form.Field>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={form.state.isSubmitting}>
                {form.state.isSubmitting ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

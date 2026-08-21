'use client';

import { useEffect } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranscriptionProviders } from '@/hooks/use-transcription-providers';
import { useCreateTranscriptionJobConfig } from '@/hooks/use-transcription-job-configs';
import { toast } from 'sonner';

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  modelId: z.string().optional(),
});

type CreateJobFormValues = z.infer<typeof schema>;

interface CreateJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProviderId?: string;
  onCreated: (jobId: string) => void;
}

export function CreateJobDialog({ open, onOpenChange, defaultProviderId, onCreated }: CreateJobDialogProps) {
  const { data: providers } = useTranscriptionProviders();
  const createMutation = useCreateTranscriptionJobConfig();

  const form = useForm({
    defaultValues: {
      name: '',
      description: '',
      modelId: defaultProviderId ?? '',
    } as CreateJobFormValues,
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      try {
        const job = await createMutation.mutateAsync({
          name: value.name.trim(),
          description: value.description?.trim() || undefined,
          modelId: value.modelId || undefined,
        });
        toast.success('Job created');
        form.reset();
        onCreated(job.id);
        onOpenChange(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create job');
      }
    },
  });

  useEffect(() => {
    if (open) form.setFieldValue('modelId', defaultProviderId ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultProviderId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Create Job</DialogTitle>
            <DialogDescription>
              Give your job a name and pick a provider. You can configure language, diarization, and everything else after creation.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <form.Field name="name">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>Name</Label>
                  <Input
                    id={field.name}
                    placeholder="e.g., Support Call Transcription"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    autoFocus
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="description">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>Description</Label>
                  <Textarea
                    id={field.name}
                    placeholder="What is this job for?"
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    rows={3}
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="modelId">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>Provider / Model</Label>
                  <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                    <SelectTrigger id={field.name}>
                      <SelectValue placeholder="Select a provider (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {providers?.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} {p.modelId ? `— ${p.modelId}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={form.state.isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.state.isSubmitting}>
              {form.state.isSubmitting ? 'Creating...' : 'Create Job'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

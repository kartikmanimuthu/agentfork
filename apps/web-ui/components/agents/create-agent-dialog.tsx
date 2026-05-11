'use client';

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
import { toast } from 'sonner';

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  type: z.enum(['simple', 'graph']),
});

type CreateAgentFormValues = z.infer<typeof schema>;

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateAgentDialog({ open, onOpenChange, onCreated }: CreateAgentDialogProps) {
  const form = useForm({
    defaultValues: {
      name: '',
      description: '',
      type: 'simple' as const,
    } as CreateAgentFormValues,
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      const defaultConfig =
        value.type === 'simple'
          ? { type: 'llm', model: 'anthropic.claude-sonnet-4-20250514', systemPrompt: '', tools: [] }
          : { nodes: [], edges: [] };

      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: value.name.trim(),
          description: value.description?.trim() || undefined,
          type: value.type,
          config: defaultConfig,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to create agent');
      }

      toast.success('Agent created');
      form.reset();
      onCreated();
      onOpenChange(false);
    },
  });

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
            <DialogTitle>Create Agent</DialogTitle>
            <DialogDescription>
              Give your agent a name and choose its type. You can configure it further after creation.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <form.Field name="name">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>Name</Label>
                  <Input
                    id={field.name}
                    placeholder="My Agent"
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
                    placeholder="What does this agent do?"
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    rows={3}
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="type">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>Type</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v as 'simple' | 'graph')}
                  >
                    <SelectTrigger id={field.name}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simple">Simple — single LLM call with tools</SelectItem>
                      <SelectItem value="graph">Graph — multi-step node workflow</SelectItem>
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
              {form.state.isSubmitting ? 'Creating...' : 'Create Agent'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

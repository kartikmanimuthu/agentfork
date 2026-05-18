'use client';

import { useParams, useRouter } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { useAgent, useUpdateAgent, useDeleteAgent } from '@/hooks/use-agents';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useEffect } from 'react';

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  status: z.enum(['draft', 'active', 'inactive']),
});

type AgentSettingsFormValues = z.infer<typeof schema>;

export default function AgentSettingsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const agentId = params.id;

  const { data: agent, isLoading } = useAgent(agentId);
  const updateMutation = useUpdateAgent(agentId);
  const deleteMutation = useDeleteAgent();

  const form = useForm({
    defaultValues: {
      name: agent?.name ?? '',
      description: agent?.description ?? '',
      status: (agent?.status ?? 'draft') as 'draft' | 'active' | 'inactive',
    } as AgentSettingsFormValues,
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      await updateMutation.mutateAsync({
        name: value.name,
        description: value.description || undefined,
        status: value.status,
      });
      toast.success('Settings saved');
    },
  });

  useEffect(() => {
    if (agent) {
      form.reset({
        name: agent.name,
        description: agent.description ?? '',
        status: agent.status as 'draft' | 'active' | 'inactive',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(agentId);
      toast.success('Agent deleted');
      router.push('/agents');
    } catch {
      toast.error('Failed to delete agent');
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 max-w-2xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-muted-foreground">Agent not found.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 bg-background max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          nativeButton={false}
          render={<Link href={`/agents/${agentId}`} aria-label="Back to agent" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">Agent Settings</h2>
        <Badge variant="outline" className="capitalize">{agent.type}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Update the agent name, description, and status.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
            className="space-y-4"
          >
            <form.Field name="name">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Name</Label>
                  <Input
                    id={field.name}
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

            <form.Field name="description">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Description</Label>
                  <Textarea
                    id={field.name}
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    rows={3}
                    placeholder="What does this agent do?"
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="status">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={field.name}>Status</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v as 'draft' | 'active' | 'inactive')}
                  >
                    <SelectTrigger id={field.name}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>

            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>Permanently delete this agent and all its versions.</CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="destructive" size="sm" nativeButton={false}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Agent
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{agent.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the agent and all its versions. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}

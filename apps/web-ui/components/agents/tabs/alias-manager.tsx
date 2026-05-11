'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { useAgentAliases, useCreateAlias, useUpdateAlias, useDeleteAlias } from '@/hooks/use-agent-aliases';
import { useAgentVersions } from '@/hooks/use-agent-versions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus } from 'lucide-react';

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  versionId: z.string().min(1, 'Version is required'),
  isDefault: z.boolean().optional(),
});

type AliasFormValues = z.infer<typeof schema>;

export function AliasManager({ agentId }: { agentId: string }) {
  const { data: aliases } = useAgentAliases(agentId);
  const { data: versions } = useAgentVersions(agentId);
  const create = useCreateAlias(agentId);
  const update = useUpdateAlias(agentId);
  const remove = useDeleteAlias(agentId);

  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      name: '',
      versionId: '',
      isDefault: false,
    } as AliasFormValues,
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      await create.mutateAsync({
        name: value.name.trim(),
        versionId: value.versionId,
        isDefault: value.isDefault,
      });
      toast.success('Alias created');
      form.reset();
      setOpen(false);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Aliases</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>
            <Button size="sm" variant="outline">
              <Plus className="h-3 w-3 mr-1" />
              New Alias
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Alias</DialogTitle>
              <DialogDescription>Map a name like "dev" or "prod" to a specific version.</DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                form.handleSubmit();
              }}
              className="space-y-4 py-2"
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
                      placeholder="e.g. dev"
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.Field name="versionId">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label>Version</Label>
                    <Select
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select version" />
                      </SelectTrigger>
                      <SelectContent>
                        {versions?.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            Version {v.version} ({v.status})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.Field name="isDefault">
                {(field) => (
                  <div className="flex items-center gap-2">
                    <Switch
                      id="alias-default"
                      checked={field.state.value ?? false}
                      onCheckedChange={(v) => field.handleChange(v)}
                    />
                    <Label htmlFor="alias-default">Set as default alias</Label>
                  </div>
                )}
              </form.Field>

              <DialogFooter>
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? 'Creating...' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {aliases?.length === 0 && (
        <p className="text-muted-foreground text-sm">No aliases configured.</p>
      )}

      {aliases?.map((alias) => (
        <div key={alias.id} className="flex items-center justify-between p-3 border rounded-lg">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{alias.name}</span>
            {alias.isDefault && <Badge variant="default" className="text-[10px]">default</Badge>}
            <span className="text-xs text-muted-foreground">→ Version {alias.version.version}</span>
          </div>
          <div className="flex items-center gap-2">
            {!alias.isDefault && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => update.mutateAsync({ aliasId: alias.id, input: { isDefault: true } }).then(() => toast.success('Set as default')).catch(() => toast.error('Failed'))}
              >
                Set default
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive"
              onClick={() => setDeleteTarget(alias.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}
    <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete alias?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setDeleteTarget(null)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              if (deleteTarget) {
                remove.mutateAsync(deleteTarget).then(() => toast.success('Deleted')).catch(() => toast.error('Failed'));
              }
              setDeleteTarget(null);
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </div>
  );
}

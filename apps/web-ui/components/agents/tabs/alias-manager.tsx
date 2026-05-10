'use client';

import { useState } from 'react';
import { useAgentAliases, useCreateAlias, useUpdateAlias, useDeleteAlias } from '@/hooks/use-agent-aliases';
import { useAgentVersions } from '@/hooks/use-agent-versions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus } from 'lucide-react';

export function AliasManager({ agentId }: { agentId: string }) {
  const { data: aliases } = useAgentAliases(agentId);
  const { data: versions } = useAgentVersions(agentId);
  const create = useCreateAlias(agentId);
  const update = useUpdateAlias(agentId);
  const remove = useDeleteAlias(agentId);

  const [name, setName] = useState('');
  const [versionId, setVersionId] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [open, setOpen] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !versionId) {
      toast.error('Name and version are required');
      return;
    }
    try {
      await create.mutateAsync({ name: name.trim(), versionId, isDefault });
      toast.success('Alias created');
      setName('');
      setVersionId('');
      setIsDefault(false);
      setOpen(false);
    } catch {
      toast.error('Failed to create alias');
    }
  };

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
            <div className="space-y-4 py-2">
              <div className="grid gap-1.5">
                <Label htmlFor="alias-name">Name</Label>
                <Input id="alias-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. dev" />
              </div>
              <div className="grid gap-1.5">
                <Label>Version</Label>
                <Select value={versionId} onValueChange={setVersionId}>
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
              </div>
              <div className="flex items-center gap-2">
                <Switch id="alias-default" checked={isDefault} onCheckedChange={setIsDefault} />
                <Label htmlFor="alias-default">Set as default alias</Label>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={create.isPending}>
                {create.isPending ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
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
              onClick={() => remove.mutateAsync(alias.id).then(() => toast.success('Deleted')).catch(() => toast.error('Failed'))}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

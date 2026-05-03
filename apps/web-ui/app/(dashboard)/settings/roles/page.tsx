'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Shield, ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createRoleSchema } from '@chatbot/shared/client';
import type { z } from 'zod';

interface PredefinedRole {
  id: string;
  name: string;
  permissions: Record<string, string[]>;
  level: number;
  predefined: boolean;
}

interface CustomRole {
  id: string;
  name: string;
  permissions: Record<string, string[]>;
  level: number;
}

const MODULES = ['Conversations', 'Messages', 'Settings', 'Users', 'Tenants'];
const ACTIONS = ['create', 'read', 'update', 'delete'];

type RoleFormValues = z.input<typeof createRoleSchema>;

function RoleDialog({
  open,
  onOpenChange,
  editingRole,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editingRole: CustomRole | null;
  onSaved: () => void;
}) {
  const form = useForm<RoleFormValues>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { name: '', permissions: {} },
    mode: 'onChange',
  });

  useEffect(() => {
    if (open) {
      if (editingRole) {
        form.reset({
          name: editingRole.name,
          permissions: editingRole.permissions || {},
        });
      } else {
        form.reset({ name: '', permissions: {} });
      }
    }
  }, [open, editingRole, form]);

  const perms = (form.watch('permissions') || {}) as Record<string, string[]>;

  function togglePermission(module: string, action: string) {
    const current = (perms as Record<string, string[]>)[module] || [];
    const next = current.includes(action)
      ? current.filter((a) => a !== action)
      : [...current, action];
    form.setValue('permissions', { ...perms, [module]: next } as RoleFormValues['permissions'], { shouldValidate: true });
  }

  const onSubmit = async (data: RoleFormValues) => {
    const payload = editingRole ? { ...data, id: editingRole.id } : data;
    const method = editingRole ? 'PUT' : 'POST';
    try {
      const res = await fetch('/api/roles', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success(editingRole ? 'Role updated' : 'Role created');
        onOpenChange(false);
        onSaved();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to save role');
      }
    } catch {
      toast.error('Failed to save role');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editingRole ? 'Edit Role' : 'Create Custom Role'}</DialogTitle>
          <DialogDescription>Configure permissions for this role.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="role-name">Role Name</Label>
              <Input
                id="role-name"
                placeholder="e.g. Content Manager"
                {...form.register('name')}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="border rounded-md">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted">
                      <th className="text-left py-2 px-3 font-medium">Module</th>
                      {ACTIONS.map((action) => (
                        <th key={action} className="text-center py-2 px-2 font-medium capitalize">{action}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MODULES.map((mod) => (
                      <tr key={mod} className="border-b last:border-0">
                        <td className="py-2 px-3 font-medium">{mod}</td>
                        {ACTIONS.map((action) => (
                          <td key={action} className="text-center py-2 px-2">
                            <Switch
                              checked={perms[mod]?.includes(action) || false}
                              onCheckedChange={() => togglePermission(mod, action)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {form.formState.errors.permissions && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.permissions.message || 'At least one permission is required'}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={!form.formState.isValid || form.formState.isSubmitting}
            >
              {form.formState.isSubmitting
                ? 'Saving...'
                : editingRole ? 'Save Changes' : 'Create Role'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function RolesPage() {
  const [predefined, setPredefined] = useState<PredefinedRole[]>([]);
  const [custom, setCustom] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);

  useEffect(() => {
    fetchRoles();
  }, []);

  async function fetchRoles() {
    setLoading(true);
    try {
      const res = await fetch('/api/roles');
      if (res.ok) {
        const data = await res.json();
        setPredefined(data.predefined || []);
        setCustom(data.custom || []);
      }
    } catch (e) {
      console.error('Failed to fetch roles', e);
    } finally {
      setLoading(false);
    }
  }

  function initDialog(role?: CustomRole) {
    setEditingRole(role ?? null);
    setDialogOpen(true);
  }

  async function deleteRole(id: string) {
    if (!confirm('Are you sure you want to delete this custom role? Affected users will be reassigned to Viewer.')) return;
    try {
      const res = await fetch(`/api/roles?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Role deleted');
        fetchRoles();
      } else {
        toast.error('Failed to delete role');
      }
    } catch {
      toast.error('Failed to delete role');
    }
  }

  const permissionSummary = (perms: Record<string, string[]>) => {
    const total = Object.values(perms).flat().length;
    return `${total} permission${total !== 1 ? 's' : ''}`;
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Shield className="h-6 w-6" />
          <h2 className="text-3xl font-bold tracking-tight">Roles & Permissions</h2>
        </div>
        <Link href="/settings">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Settings
          </Button>
        </Link>
      </div>
      <p className="text-muted-foreground">Manage predefined and custom roles for your organization.</p>

      <div className="flex justify-end">
        <Button onClick={() => initDialog()} disabled={custom.length >= 10}>
          <Plus className="mr-2 h-4 w-4" />
          Create Custom Role
        </Button>
      </div>

      {/* Predefined Roles */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Predefined Roles</h3>
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {predefined.map((role) => (
              <Card key={role.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{role.name}</CardTitle>
                  <CardDescription>{permissionSummary(role.permissions)}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1">
                  {MODULES.map((mod) => (
                    <div key={mod} className="flex items-center gap-2 text-xs">
                      <span className="font-medium w-24 truncate">{mod}</span>
                      <div className="flex gap-1">
                        {ACTIONS.map((action) => {
                          const has = role.permissions[mod]?.includes(action);
                          return (
                            <Badge
                              key={action}
                              variant={has ? 'default' : 'outline'}
                              className="text-[10px] px-1 py-0 h-4"
                            >
                              {action[0].toUpperCase()}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Custom Roles */}
      {custom.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Custom Roles</h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {custom.map((role) => (
              <Card key={role.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{role.name}</CardTitle>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => initDialog(role)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => deleteRole(role.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription>{permissionSummary(role.permissions)}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1">
                  {MODULES.map((mod) => (
                    <div key={mod} className="flex items-center gap-2 text-xs">
                      <span className="font-medium w-24 truncate">{mod}</span>
                      <div className="flex gap-1">
                        {ACTIONS.map((action) => {
                          const has = role.permissions[mod]?.includes(action);
                          return (
                            <Badge
                              key={action}
                              variant={has ? 'default' : 'outline'}
                              className="text-[10px] px-1 py-0 h-4"
                            >
                              {action[0].toUpperCase()}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <RoleDialog open={dialogOpen} onOpenChange={setDialogOpen} editingRole={editingRole} onSaved={fetchRoles} />
    </div>
  );
}

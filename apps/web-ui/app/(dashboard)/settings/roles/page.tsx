'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Shield,
  ArrowLeft,
  Plus,
  Trash2,
  Pencil,
  MoreHorizontal,
} from 'lucide-react';

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

export default function RolesPage() {
  const [predefined, setPredefined] = useState<PredefinedRole[]>([]);
  const [custom, setCustom] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [roleName, setRoleName] = useState('');
  const [rolePerms, setRolePerms] = useState<Record<string, string[]>>({});
  const [deleteTarget, setDeleteTarget] = useState<CustomRole | null>(null);

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

  function togglePermission(module: string, action: string) {
    setRolePerms((prev) => {
      const current = prev[module] || [];
      const next = current.includes(action)
        ? current.filter((a) => a !== action)
        : [...current, action];
      return { ...prev, [module]: next };
    });
  }

  function initDialog(role?: CustomRole) {
    if (role) {
      setEditingRole(role);
      setRoleName(role.name);
      setRolePerms(role.permissions || {});
    } else {
      setEditingRole(null);
      setRoleName('');
      setRolePerms({});
    }
    setDialogOpen(true);
  }

  async function saveRole() {
    const payload = {
      id: editingRole?.id,
      name: roleName,
      permissions: rolePerms,
    };
    try {
      const res = await fetch('/api/roles', {
        method: editingRole ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success(editingRole ? 'Role updated' : 'Role created');
        setDialogOpen(false);
        fetchRoles();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to save role');
      }
    } catch (e) {
      toast.error('Failed to save role');
    }
  }

  async function deleteRole(id: string) {
    try {
      const res = await fetch(`/api/roles?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Role deleted');
        setDeleteTarget(null);
        fetchRoles();
      } else {
        toast.error('Failed to delete role');
      }
    } catch (e) {
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
          <h2 className="text-3xl font-bold tracking-tight">
            Roles & Permissions
          </h2>
        </div>
        <Link href="/settings">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Settings
          </Button>
        </Link>
      </div>
      <p className="text-muted-foreground">
        Manage predefined and custom roles for your organization.
      </p>

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
                  <CardDescription>
                    {permissionSummary(role.permissions)}
                  </CardDescription>
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
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => initDialog(role)}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleteTarget(role)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <CardDescription>
                    {permissionSummary(role.permissions)}
                  </CardDescription>
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

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingRole ? 'Edit Role' : 'Create Custom Role'}
            </DialogTitle>
            <DialogDescription>
              Configure permissions for this role.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Role Name</Label>
              <Input
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                placeholder="e.g. Content Manager"
              />
            </div>
            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Module</TableHead>
                      {ACTIONS.map((action) => (
                        <TableHead
                          key={action}
                          className="text-center capitalize"
                        >
                          {action}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {MODULES.map((mod) => (
                      <TableRow key={mod}>
                        <TableCell className="font-medium">{mod}</TableCell>
                        {ACTIONS.map((action) => (
                          <TableCell key={action} className="text-center">
                            <Switch
                              checked={
                                rolePerms[mod]?.includes(action) || false
                              }
                              onCheckedChange={() =>
                                togglePermission(mod, action)
                              }
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={saveRole}>
              {editingRole ? 'Save Changes' : 'Create Role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete custom role?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? Affected users
              will be reassigned to Viewer. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteRole(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

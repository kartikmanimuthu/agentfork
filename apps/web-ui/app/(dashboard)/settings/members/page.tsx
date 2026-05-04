'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useForm } from '@tanstack/react-form';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header';
import { Spinner } from '@/components/ui/spinner';
import { createInvitationSchema } from '@chatbot/shared/client';
import { Users, ArrowLeft, Plus, Trash2, RefreshCw } from 'lucide-react';
import { formatDate, useTenantTimezone } from '@/lib/date-utils';

interface Member {
  userId: string;
  tenantId: string;
  role: string;
  assignedAt: string;
  user: { id: string; email: string };
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
}

const ROLE_OPTIONS = ['Owner', 'Admin', 'Member', 'Viewer'];

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeMemberTarget, setRemoveMemberTarget] = useState<Member | null>(null);
  const [revokeInviteTarget, setRevokeInviteTarget] = useState<Invitation | null>(null);
  const timezone = useTenantTimezone();

  const inviteForm = useForm({
    defaultValues: {
      email: '',
      role: 'Member',
    },
    validators: {
      onChange: createInvitationSchema,
    },
    onSubmit: async ({ value }) => {
      const res = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (res.ok) {
        toast.success('Invitation sent');
        setInviteOpen(false);
        inviteForm.reset();
        fetchData();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to send invitation');
      }
    },
  });

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch('/api/members'),
        fetch('/api/invitations'),
      ]);
      if (membersRes.ok) setMembers(await membersRes.json());
      if (invitesRes.ok) setInvitations(await invitesRes.json());
    } catch (e) {
      console.error('Failed to fetch members', e);
    } finally {
      setLoading(false);
    }
  }

  async function updateRole(userId: string, role: string) {
    try {
      const res = await fetch('/api/members', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      });
      if (res.ok) {
        toast.success('Role updated');
        fetchData();
      } else {
        toast.error('Failed to update role');
      }
    } catch (e) {
      toast.error('Failed to update role');
    }
  }

  async function removeMember(userId: string) {
    try {
      const res = await fetch(`/api/members?userId=${userId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Member removed');
        setRemoveMemberTarget(null);
        fetchData();
      } else {
        toast.error('Failed to remove member');
      }
    } catch (e) {
      toast.error('Failed to remove member');
    }
  }

  async function revokeInvite(id: string) {
    try {
      const res = await fetch(`/api/invitations?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Invitation revoked');
        setRevokeInviteTarget(null);
        fetchData();
      } else {
        toast.error('Failed to revoke invitation');
      }
    } catch (e) {
      toast.error('Failed to revoke invitation');
    }
  }

  const formatDateLocal = (dateStr: string) => {
    if (!dateStr) return '—';
    return formatDate(dateStr, timezone);
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'Owner':
        return 'default';
      case 'Admin':
        return 'secondary';
      case 'Member':
        return 'outline';
      default:
        return 'outline';
    }
  };

  const memberColumns: ColumnDef<Member>[] = useMemo(
    () => [
      {
        accessorKey: 'user.email',
        header: ({ column }) => <DataTableColumnHeader column={column} title="User" />,
        cell: ({ row }) => {
          const email = row.original.user?.email || row.original.userId;
          return (
            <div className="flex items-center gap-3">
              <Avatar size="sm">
                <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${email}`} />
                <AvatarFallback>{email?.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">{email}</span>
            </div>
          );
        },
      },
      {
        accessorKey: 'role',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />,
        cell: ({ row }) => (
          <Select
            value={row.original.role}
            onValueChange={(value) => updateRole(row.original.userId, value)}
          >
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
      {
        accessorKey: 'assignedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Joined" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{formatDateLocal(row.original.assignedAt)}</span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="text-right">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={() => setRemoveMemberTarget(row.original)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  const inviteColumns: ColumnDef<Invitation>[] = useMemo(
    () => [
      {
        accessorKey: 'email',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
        cell: ({ row }) => <span className="text-sm">{row.original.email}</span>,
      },
      {
        accessorKey: 'role',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />,
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.role}</Badge>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Badge variant="secondary">{row.original.status}</Badge>
        ),
      },
      {
        accessorKey: 'expiresAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expires" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{formatDateLocal(row.original.expiresAt)}</span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="text-right">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setRevokeInviteTarget(row.original)}
            >
              Revoke
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Users className="h-6 w-6" />
          <h2 className="text-3xl font-bold tracking-tight">Members</h2>
        </div>
        <Link href="/settings">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Settings
          </Button>
        </Link>
      </div>
      <p className="text-muted-foreground">Manage your team members and invitations.</p>

      <div className="flex justify-between items-center">
        <Button onClick={() => setInviteOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Invite Member
        </Button>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Members Table */}
      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>{members.length} member{members.length !== 1 ? 's' : ''} in your organization.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <DataTable
              columns={memberColumns}
              data={members}
              loading={false}
              enablePagination
              enableSorting
              enableFiltering={false}
              defaultPageSize={25}
              emptyMessage="No members found."
            />
          )}
        </CardContent>
      </Card>

      {/* Invitations Table */}
      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Invitations</CardTitle>
            <CardDescription>{invitations.length} pending invitation{invitations.length !== 1 ? 's' : ''}.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={inviteColumns}
              data={invitations}
              loading={false}
              enablePagination
              enableSorting
              enableFiltering={false}
              defaultPageSize={10}
              emptyMessage="No pending invitations."
            />
          </CardContent>
        </Card>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={(open) => {
        setInviteOpen(open);
        if (!open) inviteForm.reset();
      }}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              inviteForm.handleSubmit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Invite Member</DialogTitle>
              <DialogDescription>Send an invitation to join your organization.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <inviteForm.Field name="email">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Email</Label>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="email"
                      placeholder="colleague@company.com"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      aria-invalid={!field.state.meta.isValid}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-sm text-destructive">
                        {field.state.meta.errors
                          .map((e) => (typeof e === 'string' ? e : (e as any)?.message ?? String(e)))
                          .join(', ')}
                      </p>
                    )}
                  </div>
                )}
              </inviteForm.Field>
              <inviteForm.Field name="role">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Role</Label>
                    <Select
                      value={field.state.value}
                      onValueChange={(value) => field.handleChange(value)}
                    >
                      <SelectTrigger id={field.name}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((r) => (
                          <SelectItem key={r} value={r}>{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </inviteForm.Field>
            </div>
            <DialogFooter>
              <inviteForm.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                {([canSubmit, isSubmitting]) => (
                  <Button type="submit" disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Spinner className="mr-2 size-3" />
                        Sending...
                      </>
                    ) : (
                      'Send Invitation'
                    )}
                  </Button>
                )}
              </inviteForm.Subscribe>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {/* Remove Member Confirmation */}
      <AlertDialog open={!!removeMemberTarget} onOpenChange={(open) => !open && setRemoveMemberTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{removeMemberTarget?.user?.email}</strong> from your organization? They will lose access immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => removeMemberTarget && removeMember(removeMemberTarget.userId)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke Invitation Confirmation */}
      <AlertDialog open={!!revokeInviteTarget} onOpenChange={(open) => !open && setRevokeInviteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke the invitation for <strong>{revokeInviteTarget?.email}</strong>? They will no longer be able to join using this invite.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => revokeInviteTarget && revokeInvite(revokeInviteTarget.id)}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

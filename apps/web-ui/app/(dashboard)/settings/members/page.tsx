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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Users, ArrowLeft, Plus, Trash2, RefreshCw } from 'lucide-react';
import { formatDate, useTenantTimezone } from '@/lib/date-utils';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createInvitationSchema } from '@chatbot/shared/client';
import type { z } from 'zod';

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

type InviteFormValues = z.infer<typeof createInvitationSchema>;

function InviteDialog({
  open,
  onOpenChange,
  onSent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSent: () => void;
}) {
  const form = useForm<InviteFormValues>({
    resolver: zodResolver(createInvitationSchema),
    defaultValues: { email: '', role: 'Member' },
    mode: 'onChange',
  });

  useEffect(() => {
    if (open) {
      form.reset({ email: '', role: 'Member' });
    }
  }, [open, form]);

  const onSubmit = async (data: InviteFormValues) => {
    try {
      const res = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        toast.success('Invitation sent');
        onOpenChange(false);
        onSent();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to send invitation');
      }
    } catch {
      toast.error('Failed to send invitation');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Member</DialogTitle>
          <DialogDescription>Send an invitation to join your organization.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@company.com"
                {...form.register('email')}
              />
              {form.formState.errors.email && (
                <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={form.watch('role')}
                onValueChange={(v) => form.setValue('role', v, { shouldValidate: true })}
              >
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={!form.formState.isValid || form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const timezone = useTenantTimezone();

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
    } catch {
      toast.error('Failed to update role');
    }
  }

  async function removeMember(userId: string) {
    if (!confirm('Are you sure you want to remove this member?')) return;
    try {
      const res = await fetch(`/api/members?userId=${userId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Member removed');
        fetchData();
      } else {
        toast.error('Failed to remove member');
      }
    } catch {
      toast.error('Failed to remove member');
    }
  }

  async function revokeInvite(id: string) {
    if (!confirm('Revoke this invitation?')) return;
    try {
      const res = await fetch(`/api/invitations?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Invitation revoked');
        fetchData();
      } else {
        toast.error('Failed to revoke invitation');
      }
    } catch {
      toast.error('Failed to revoke invitation');
    }
  }

  const formatDateLocal = (dateStr: string) => formatDate(dateStr, timezone);

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
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">User</th>
                    <th className="text-left py-2 px-3 font-medium">Role</th>
                    <th className="text-left py-2 px-3 font-medium">Joined</th>
                    <th className="text-right py-2 px-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.userId} className="border-b last:border-0 hover:bg-accent/50">
                      <td className="py-2 px-3">{member.user?.email || member.userId}</td>
                      <td className="py-2 px-3">
                        <Select
                          value={member.role}
                          onValueChange={(value) => updateRole(member.userId, value)}
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
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{formatDateLocal(member.assignedAt)}</td>
                      <td className="py-2 px-3 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => removeMember(member.userId)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">Email</th>
                    <th className="text-left py-2 px-3 font-medium">Role</th>
                    <th className="text-left py-2 px-3 font-medium">Status</th>
                    <th className="text-left py-2 px-3 font-medium">Expires</th>
                    <th className="text-right py-2 px-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((invite) => (
                    <tr key={invite.id} className="border-b last:border-0 hover:bg-accent/50">
                      <td className="py-2 px-3">{invite.email}</td>
                      <td className="py-2 px-3">
                        <Badge variant="outline">{invite.role}</Badge>
                      </td>
                      <td className="py-2 px-3">
                        <Badge variant="secondary">{invite.status}</Badge>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{formatDateLocal(invite.expiresAt)}</td>
                      <td className="py-2 px-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => revokeInvite(invite.id)}
                        >
                          Revoke
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} onSent={fetchData} />
    </div>
  );
}

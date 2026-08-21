'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';

interface AllowedContact {
  id: string;
  phoneNumber: string;
  label: string | null;
  createdAt: string;
}

const addContactSchema = z.object({
  phoneNumber: z.string().regex(/^\d{10,15}$/, 'Digits only, with country code, no + or spaces'),
  label: z.string().optional(),
});

export default function AllowlistPage({ params }: { params: Promise<{ id: string }> }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [restrictToAllowlist, setRestrictToAllowlist] = useState(true);
  const [contacts, setContacts] = useState<AllowedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingToggle, setSavingToggle] = useState(false);
  const [newPhoneNumber, setNewPhoneNumber] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    params.then(({ id }) => {
      setAccountId(id);
      fetchAllowlist(id);
    });
  }, [params]);

  const fetchAllowlist = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/accounts/${id}/allowlist`);
      if (!res.ok) throw new Error('Failed to load allowlist');
      const data = await res.json();
      setRestrictToAllowlist(data.restrictToAllowlist);
      setContacts(data.contacts ?? []);
    } catch {
      toast.error('Failed to load allowlist');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (checked: boolean) => {
    if (!accountId) return;
    setSavingToggle(true);
    try {
      const res = await fetch(`/api/whatsapp/accounts/${accountId}/allowlist`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restrictToAllowlist: checked }),
      });
      if (!res.ok) throw new Error('Failed to update');
      setRestrictToAllowlist(checked);
      toast.success(checked ? 'Allowlist restriction enabled' : 'Allowlist restriction disabled');
    } catch {
      toast.error('Failed to update allowlist setting');
    } finally {
      setSavingToggle(false);
    }
  };

  const handleAddContact = async () => {
    if (!accountId) return;
    const parsed = addContactSchema.safeParse({ phoneNumber: newPhoneNumber, label: newLabel || undefined });
    if (!parsed.success) {
      setAddError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    setAddError('');
    setAdding(true);
    try {
      const res = await fetch(`/api/whatsapp/accounts/${accountId}/allowlist/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.status === 409) {
        setAddError('This phone number is already on the allowlist');
        return;
      }
      if (!res.ok) throw new Error('Failed to add');
      const contact = await res.json();
      setContacts((prev) => [contact, ...prev]);
      setNewPhoneNumber('');
      setNewLabel('');
      toast.success('Number added to allowlist');
    } catch {
      toast.error('Failed to add number');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveContact = async (contactId: string) => {
    if (!accountId) return;
    try {
      const res = await fetch(`/api/whatsapp/accounts/${accountId}/allowlist/contacts/${contactId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to remove');
      setContacts((prev) => prev.filter((c) => c.id !== contactId));
      toast.success('Number removed from allowlist');
    } catch {
      toast.error('Failed to remove number');
    }
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10 text-green-600">
            <WhatsAppIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Allowlist</h2>
            <p className="text-sm text-muted-foreground">Control which numbers receive automated replies.</p>
          </div>
        </div>
        <Link href="/settings/channels/whatsapp">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Channels
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Restrict Auto-Replies</CardTitle>
              <CardDescription>
                When on, only numbers listed below receive automated replies.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Switch
                  checked={restrictToAllowlist}
                  onCheckedChange={handleToggle}
                  disabled={savingToggle}
                />
                <span className="text-sm">{restrictToAllowlist ? 'Restricted to allowlist' : 'Open to everyone'}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Allowed Numbers</CardTitle>
              <CardDescription>Add the numbers that should receive automated replies.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="new-phone-number">Phone Number</Label>
                  <Input
                    id="new-phone-number"
                    placeholder="918826603017"
                    value={newPhoneNumber}
                    onChange={(e) => setNewPhoneNumber(e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-2">
                  <Label htmlFor="new-label">Label (optional)</Label>
                  <Input
                    id="new-label"
                    placeholder="Omar - testing"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                  />
                </div>
                <Button className="mt-7" onClick={handleAddContact} disabled={adding}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add
                </Button>
              </div>
              {addError && <p className="text-xs text-destructive">{addError}</p>}

              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No numbers added yet. Add a number above to let it receive replies.
                </p>
              ) : (
                <div className="space-y-2">
                  {contacts.map((contact) => (
                    <div key={contact.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <p className="text-sm font-medium">{contact.phoneNumber}</p>
                        {contact.label && <p className="text-xs text-muted-foreground">{contact.label}</p>}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleRemoveContact(contact.id)}
                        aria-label="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

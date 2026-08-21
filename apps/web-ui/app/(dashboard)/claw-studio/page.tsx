'use client';

import { useState } from 'react';
import { Cat, KeyRound, Rocket, Copy, Plus, Building2, Download, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { env } from '@/lib/env';
import {
  useClawStudio,
  useProvisionStudio,
  useStudioAccounts,
  useCreateStudioAccount,
  useResetAccountPassword,
  useRenameStudioAccount,
  useDeleteStudioAccount,
  type StudioAccount,
} from '@/hooks/use-claw-studio';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Claw Studio accounts.
 *
 * Each account is its own tenant, which is what keeps memories, LLM providers,
 * skills, MCP servers and scheduled tasks separate between them — everything in
 * Claw is keyed on tenant. So the first account lives in the organisation the
 * user is already signed into, and each additional one creates a fresh tenant
 * that only they belong to.
 *
 * Mission Control is a separate app with its own Studio ID + password login, so
 * these buttons hand off rather than navigate.
 */
export default function ClawStudioPage() {
  const { data: currentStudio, isLoading: loadingCurrent } = useClawStudio();
  const { data: accounts, isLoading: loadingAccounts } = useStudioAccounts();
  const provision = useProvisionStudio();
  const createAccount = useCreateStudioAccount();
  const resetPassword = useResetAccountPassword();

  const renameAccount = useRenameStudioAccount();
  const deleteAccount = useDeleteStudioAccount();

  const [revealed, setRevealed] = useState<{ studioId: string; password: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [renaming, setRenaming] = useState<StudioAccount | null>(null);
  const [renameLabel, setRenameLabel] = useState('');
  /** The account the delete dialog is open for, plus the name typed to confirm it. */
  const [deleting, setDeleting] = useState<StudioAccount | null>(null);
  const [confirmName, setConfirmName] = useState('');

  const missionControlUrl = env.NEXT_PUBLIC_MISSION_CONTROL_URL;
  const isLoading = loadingCurrent || loadingAccounts;
  const list = accounts ?? [];

  const openRename = (account: StudioAccount) => {
    setRenaming(account);
    setRenameLabel(account.tenantName);
  };

  const handleRename = async () => {
    if (!renaming) return;
    try {
      const result = await renameAccount.mutateAsync({
        studioRecordId: renaming.id,
        label: renameLabel,
      });
      toast.success(`Renamed to "${result.tenantName}"`);
      setRenaming(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not rename the account');
    }
  };

  const openDelete = (account: StudioAccount) => {
    setDeleting(account);
    setConfirmName('');
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      const result = await deleteAccount.mutateAsync(deleting.id);
      const rows = Object.values(result.deleted).reduce((sum, n) => sum + n, 0);
      toast.success(
        `Deleted "${result.tenantName}"${rows > 0 ? ` and ${rows} associated record${rows === 1 ? '' : 's'}` : ''}`,
      );
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the account');
    }
  };

  const handleProvisionCurrent = async () => {
    try {
      const result = await provision.mutateAsync();
      setRevealed({ studioId: result.studioId, password: result.password });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not set up Claw');
    }
  };

  const handleCreateAccount = async () => {
    try {
      const result = await createAccount.mutateAsync(label);
      setCreating(false);
      setLabel('');
      setRevealed({ studioId: result.studioId, password: result.password });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the account');
    }
  };

  const handleReset = async (account: StudioAccount) => {
    try {
      const { password } = await resetPassword.mutateAsync(account.id);
      setRevealed({ studioId: account.studioId, password });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reset the password');
    }
  };

  const open = (account: StudioAccount) => {
    if (!missionControlUrl) {
      toast.error('Mission Control URL is not configured');
      return;
    }
    // Prefills the Studio ID on Mission Control's own login page. The password
    // is never carried across — it exists only as a hash on our side.
    window.open(
      `${missionControlUrl}/login?studio=${encodeURIComponent(account.studioId)}`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  /**
   * Downloads the credentials as a CSV, mirroring the one-time
   * `credentials.csv` an AWS access key hands you. The password is shown exactly
   * once and cannot be retrieved afterwards, so copy-only left the user
   * hand-transcribing the one value they can never see again.
   *
   * Quotes every field and doubles any embedded quote, per RFC 4180 — generated
   * passwords can contain commas and quotes, and an unescaped one would shift
   * every following column when the file is opened in a spreadsheet.
   */
  const downloadCredentials = (studioId: string, password: string) => {
    const loginUrl = `${env.NEXT_PUBLIC_MISSION_CONTROL_URL}/login?studio=${encodeURIComponent(studioId)}`;
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [
      ['Studio ID', 'Password', 'Login URL'].map(cell).join(','),
      [studioId, password, loginUrl].map(cell).join(','),
    ].join('\r\n');

    // Blob + revoked object URL rather than a data: URI — a data URL puts the
    // password in the browser's download history as part of the address.
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `claw-studio-${studioId}-credentials.csv`;
    // Appended before clicking, and revoked only after: Firefox ignores click() on
    // an element that is not in the document, and revoking synchronously can race
    // the download in engines that do honour it. Either way the failure was silent
    // — the success toast still fired — while this is the ONLY way to keep a
    // password the dialog itself says is shown once and can never be retrieved.
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    toast.success('Credentials downloaded');
  };

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="flex-1 space-y-6 p-4 pt-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Claw Studio</h2>
          <p className="text-muted-foreground">
            Each account has its own Claw, its own memory and its own connected tools.
          </p>
        </div>
        {list.length > 0 && (
          <Button data-testid="new-account" onClick={() => setCreating(true)}>
            <Plus className="mr-2 size-4" />
            New account
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full max-w-xl" />
      ) : list.length === 0 ? (
        <Card className="max-w-xl" data-testid="claw-card">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Cat className="size-6 text-primary" />
              </div>
              <div>
                <CardTitle>Set up Claw</CardTitle>
                <CardDescription>You don&apos;t have a Claw Studio account yet.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            We&apos;ll generate a Studio ID and password for you. The password is shown once and
            can&apos;t be viewed again — you can reset it, but not recover it.
          </CardContent>
          <CardFooter>
            {/* The first account lands in the organisation the user is already
                signed into, so their existing providers and knowledge bases are
                the ones Claw picks up. Extra accounts get their own tenant. */}
            <Button
              data-testid="generate-studio"
              onClick={handleProvisionCurrent}
              disabled={provision.isPending || Boolean(currentStudio)}
            >
              <KeyRound className="mr-2 size-4" />
              {provision.isPending ? 'Setting up…' : 'Generate Studio ID & password'}
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="claw-card">
          {list.map((account) => (
            <Card key={account.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Cat className="size-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex items-center gap-2 truncate text-base">
                      <span className="truncate">{account.claw?.name ?? 'Claw'}</span>
                      {account.isCurrentTenant && (
                        <Badge variant="secondary" className="shrink-0">
                          This org
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-1 truncate">
                      <Building2 className="size-3 shrink-0" />
                      <span className="truncate">{account.tenantName}</span>
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-muted-foreground">Studio ID</span>
                  <code
                    data-testid="studio-id"
                    className="truncate rounded bg-muted px-2 py-0.5 text-xs"
                    title={account.studioId}
                  >
                    {account.studioId}
                  </code>
                </div>
                <p className="text-xs text-muted-foreground">
                  {account.lastLoginAt
                    ? `Last opened ${new Date(account.lastLoginAt).toLocaleDateString()}`
                    : 'Never opened'}
                  {' · '}
                  Created {new Date(account.createdAt).toLocaleDateString()}
                </p>
              </CardContent>
              <CardFooter className="flex flex-wrap gap-2">
                <Button data-testid="mission-control" size="sm" onClick={() => open(account)}>
                  <Rocket className="mr-2 size-4" />
                  Open
                </Button>
                <Button
                  data-testid="reset-password"
                  size="sm"
                  variant="outline"
                  onClick={() => handleReset(account)}
                  disabled={resetPassword.isPending}
                >
                  <KeyRound className="mr-2 size-4" />
                  Reset password
                </Button>
                <Button
                  data-testid="rename-account"
                  size="icon"
                  variant="outline"
                  className="size-8"
                  aria-label={`Rename ${account.tenantName}`}
                  title="Rename"
                  onClick={() => openRename(account)}
                >
                  <Pencil className="size-4" />
                </Button>
                {/* Disabled for exactly the two cases StudioService refuses, so the
                    reason is visible before the click rather than as an error after
                    it: deleting the tenant you are signed into pulls the session's
                    own ground away, and deleting your last account strands you with
                    no list to create a new one from. */}
                <Button
                  data-testid="delete-account"
                  size="icon"
                  variant="outline"
                  className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Delete ${account.tenantName}`}
                  title={
                    account.isCurrentTenant
                      ? 'Switch to another account before deleting this one'
                      : list.length <= 1
                        ? 'You cannot delete your only account'
                        : 'Delete'
                  }
                  disabled={account.isCurrentTenant || list.length <= 1 || deleteAccount.isPending}
                  onClick={() => openDelete(account)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={(next) => !next && setCreating(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Claw Studio account</DialogTitle>
            <DialogDescription>
              This creates a completely separate Claw. It won&apos;t share memories, connected tools
              or scheduled tasks with your other accounts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="account-label">Account name</Label>
            <Input
              id="account-label"
              data-testid="account-label"
              value={label}
              maxLength={60}
              placeholder="e.g. Research, Client work"
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && label.trim() && !createAccount.isPending) {
                  void handleCreateAccount();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              data-testid="create-account"
              onClick={handleCreateAccount}
              disabled={!label.trim() || createAccount.isPending}
            >
              {createAccount.isPending ? 'Creating…' : 'Create account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revealed} onOpenChange={(next) => !next && setRevealed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save these credentials</DialogTitle>
            <DialogDescription>
              The password is shown only once. Store it securely — you can reset it, but you cannot
              view it again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Studio ID</Label>
              <div className="flex gap-2">
                <Input data-testid="reveal-studio-id" readOnly value={revealed?.studioId ?? ''} />
                <Button variant="outline" size="icon" onClick={() => revealed && copy(revealed.studioId)}>
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Password</Label>
              <div className="flex gap-2">
                <Input data-testid="studio-password" readOnly value={revealed?.password ?? ''} />
                <Button variant="outline" size="icon" onClick={() => revealed && copy(revealed.password)}>
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full"
              data-testid="download-credentials"
              onClick={() => revealed && downloadCredentials(revealed.studioId, revealed.password)}
            >
              <Download className="mr-2 size-4" />
              Download .csv
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename account</DialogTitle>
            <DialogDescription>
              This is the name shown here and wherever the account appears. It does not change the
              Studio ID or the password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-label">Account name</Label>
            <Input
              id="rename-label"
              data-testid="rename-label"
              value={renameLabel}
              maxLength={60}
              onChange={(e) => setRenameLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameLabel.trim() && !renameAccount.isPending) {
                  void handleRename();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              data-testid="confirm-rename"
              onClick={handleRename}
              disabled={!renameLabel.trim() || renameLabel.trim() === renaming?.tenantName || renameAccount.isPending}
            >
              {renameAccount.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Typed confirmation, not a plain "Are you sure?". This deletes the
          account's tenant and everything keyed to it — memories, workspace files,
          providers, skills, scheduled tasks, run history — with no recovery path,
          so the dialog names what goes and makes the click deliberate. */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive" />
              Delete this account?
            </DialogTitle>
            <DialogDescription>
              This permanently deletes <strong>{deleting?.tenantName}</strong> and everything in it.
              It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Removed with it: Claw&apos;s memories and workspace files, LLM providers, MCP servers,
            skills, scheduled tasks, chat sessions and run history, and your access to this account.
          </p>
          <div className="space-y-2">
            <Label htmlFor="confirm-name">
              Type <span className="font-mono font-semibold">{deleting?.tenantName}</span> to confirm
            </Label>
            <Input
              id="confirm-name"
              data-testid="confirm-delete-name"
              value={confirmName}
              autoComplete="off"
              onChange={(e) => setConfirmName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              data-testid="confirm-delete"
              variant="destructive"
              onClick={handleDelete}
              disabled={confirmName !== deleting?.tenantName || deleteAccount.isPending}
            >
              {deleteAccount.isPending ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

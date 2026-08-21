'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, CheckCircle2, Loader2, PlugZap, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
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
import { ConnectorSecretField } from '@/components/connectors/connector-secret-field';
import type { FieldSpec } from '@/components/connectors/channel-fields';
import {
  useIntegration,
  useAddIntegrationAccount,
  useUpdateIntegrationAccount,
  useRemoveIntegrationAccount,
  useTestIntegration,
  type IntegrationId,
  type IntegrationAccountSummary,
} from '@/hooks/use-integrations';
import { INTEGRATION_FIELDS } from './integration-fields';
import { INTEGRATION_VISUALS } from './integration-visuals';

function FieldInputs({
  fields,
  values,
  onChange,
  masked,
}: {
  fields: FieldSpec[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  masked?: Record<string, string>;
}) {
  return (
    <>
      {fields.map((field) =>
        field.secret ? (
          <ConnectorSecretField
            key={field.name}
            id={field.name}
            label={field.label}
            value={values[field.name] ?? ''}
            onChange={(v) => onChange(field.name, v)}
            maskedValue={masked?.[field.name]}
            placeholder={field.placeholder}
            hint={field.hint}
            required={field.required}
          />
        ) : (
          <div key={field.name} className="grid gap-1.5">
            <Label htmlFor={field.name}>{field.label}</Label>
            <Input
              id={field.name}
              value={values[field.name] ?? masked?.[field.name] ?? ''}
              onChange={(e) => onChange(field.name, e.target.value)}
              placeholder={field.placeholder}
            />
            {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
          </div>
        ),
      )}
    </>
  );
}

function AccountRow({
  integration,
  account,
  multi,
  onChanged,
}: {
  integration: IntegrationId;
  account: IntegrationAccountSummary;
  multi: boolean;
  onChanged: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const update = useUpdateIntegrationAccount(integration);
  const remove = useRemoveIntegrationAccount(integration);
  const test = useTestIntegration(integration);

  const handleMakeDefault = async () => {
    try {
      await update.mutateAsync({ accountId: account.accountId, input: { makeDefault: true } });
      toast.success(`${account.label} set as default`);
      onChanged();
    } catch (e) {
      toast.error('Failed to set default', { description: e instanceof Error ? e.message : undefined });
    }
  };

  const handleTest = async () => {
    try {
      const result = await test.mutateAsync({ accountId: account.accountId });
      toast.success('Connection verified', { description: result.detail });
    } catch (e) {
      toast.error('Connection failed', { description: e instanceof Error ? e.message : undefined });
    }
  };

  const handleRemove = async () => {
    try {
      await remove.mutateAsync(account.accountId);
      toast.success(`Removed ${account.label}`);
      onChanged();
    } catch (e) {
      toast.error('Failed to remove account', { description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />
        <span className="text-sm font-medium">{account.label}</span>
        {account.isDefault ? (
          <Badge variant="secondary" className="gap-1 text-xs">
            <Star className="h-3 w-3" /> Default
          </Badge>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={test.isPending}
          onClick={handleTest}
          aria-label={`Test ${account.label}`}
        >
          {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
        </Button>
        {multi && !account.isDefault ? (
          <Button variant="ghost" size="sm" disabled={update.isPending} onClick={handleMakeDefault}>
            Make default
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={remove.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {account.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the stored credentials for this account. Claw will no longer be able to use it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void handleRemove();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function IntegrationAccountsFormInner({ integration }: { integration: IntegrationId }) {
  const router = useRouter();
  const spec = INTEGRATION_FIELDS[integration];
  const visual = INTEGRATION_VISUALS[integration];
  const { data: detail, isLoading, refetch } = useIntegration(integration);

  const add = useAddIntegrationAccount(integration);
  const update = useUpdateIntegrationAccount(integration);
  const test = useTestIntegration(integration);

  const [values, setValues] = useState<Record<string, string>>({});
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setValue = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));

  // OAuth-mode integrations have no manual form or account-management UI of
  // their own — connecting is a single click straight to the provider from
  // the integrations list (see integrations-client.tsx). This page only ever
  // gets hit for one directly if a stale link/bookmark points here; bounce
  // back to the list rather than showing a page with nothing useful on it.
  const isOAuth = detail?.authMode === 'oauth';
  useEffect(() => {
    if (isOAuth) router.replace('/integrations');
  }, [isOAuth, router]);

  if (isLoading || !detail || isOAuth) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const multi = detail.accountMode === 'multi';
  // Single-account integrations edit their sole 'default' row in place; multi
  // ones always add a new row below the existing account list.
  const singleAccount = !multi ? detail.accounts[0] : undefined;
  const missingRequired = (spec?.fields ?? []).filter(
    (f) => f.required && !values[f.name]?.trim() && !singleAccount?.fields[f.name],
  );

  const handleSave = async () => {
    setError(null);
    try {
      if (singleAccount) {
        await update.mutateAsync({ accountId: 'default', input: values });
      } else {
        await add.mutateAsync(values);
      }
      setValues({});
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
      toast.success(`${detail.displayName} account connected`);
      void refetch();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to save';
      setError(message);
      toast.error('Save failed', { description: message });
    }
  };

  const handleTest = async () => {
    setError(null);
    const overrides: Record<string, string> = {};
    for (const key of spec?.testOverrideKeys ?? []) {
      const typed = values[key]?.trim();
      if (typed) overrides[key] = typed;
    }
    try {
      const result = await test.mutateAsync(singleAccount ? { accountId: 'default', overrides } : { overrides });
      toast.success('Connection verified', { description: result.detail });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Connection test failed';
      toast.error('Connection failed', { description: message });
    }
  };

  const Icon = visual.icon;
  const canTest = Object.keys(values).some((k) => values[k]?.trim()) || Boolean(singleAccount);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2" nativeButton={false} render={<Link href="/integrations" />}>
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to integrations
      </Button>

      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${visual.iconBg} ${visual.iconColor}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{detail.displayName}</h1>
          <p className="text-sm text-muted-foreground">{detail.description}</p>
        </div>
      </div>

      {detail.accounts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connected accounts</CardTitle>
            <CardDescription>
              {multi
                ? 'Claw uses the default account when a request doesn’t name one.'
                : 'Claw uses this account for every request.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {detail.accounts.map((account) => (
              <AccountRow
                key={account.accountId}
                integration={integration}
                account={account}
                multi={multi}
                onChanged={() => void refetch()}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{singleAccount ? 'Update credentials' : 'Connect an account'}</CardTitle>
          <CardDescription>
            {singleAccount
              ? 'Enter new values to rotate the stored credentials. Leave a field blank to keep its existing value.'
              : `Enter your ${detail.displayName} credentials. They are encrypted before being stored.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FieldInputs fields={spec?.fields ?? []} values={values} onChange={setValue} masked={singleAccount?.fields} />

          {missingRequired.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Required before saving: {missingRequired.map((f) => f.label).join(', ')}.
            </p>
          ) : null}

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleSave} disabled={add.isPending || update.isPending || missingRequired.length > 0}>
              {add.isPending || update.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : justSaved ? (
                <Check className="mr-2 h-4 w-4" />
              ) : null}
              {justSaved ? 'Saved' : singleAccount ? 'Save' : 'Connect'}
            </Button>
            <Button variant="outline" onClick={handleTest} disabled={test.isPending || !canTest}>
              {test.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
              Test Connection
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{spec?.setupHint}</p>
        </CardContent>
      </Card>

      {spec?.setupSteps?.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How to connect</CardTitle>
            <CardDescription>Follow these steps to get the values above.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              {spec.setupSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export function IntegrationAccountsForm({ integration }: { integration: IntegrationId }) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl space-y-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      }
    >
      <IntegrationAccountsFormInner integration={integration} />
    </Suspense>
  );
}

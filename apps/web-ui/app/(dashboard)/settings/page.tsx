'use client';

import { useSession } from 'next-auth/react';

export default function SettingsPage() {
  const { data: session } = useSession();

  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Settings</h2>
      <div className="space-y-4">
        <div className="rounded-md border p-4">
          <h3 className="text-sm font-medium">Profile</h3>
          <p className="mt-1 text-sm text-muted-foreground">{session?.user?.email}</p>
        </div>
        <div className="rounded-md border p-4">
          <h3 className="text-sm font-medium">Organization</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Tenant ID: {session?.user?.tenantId ?? 'None'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Role: {session?.user?.role ?? 'None'}
          </p>
        </div>
      </div>
    </div>
  );
}

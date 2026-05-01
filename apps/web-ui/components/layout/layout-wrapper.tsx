'use client';

import { SessionProvider } from 'next-auth/react';
import { AuthGuard } from './auth-guard';
import { Sidebar } from './sidebar';

export function LayoutWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AuthGuard>
        <div className="flex h-screen">
          <Sidebar />
          <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
        </div>
      </AuthGuard>
    </SessionProvider>
  );
}

'use client';

import { SessionProvider } from 'next-auth/react';
import { AuthGuard } from './auth-guard';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { Footer } from './footer';

export function LayoutWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AuthGuard>
        <div className="flex min-h-screen bg-background h-screen overflow-hidden">
          <Sidebar />
          <div className="flex flex-col flex-1 min-h-0 min-w-0">
            <Header />
            <main className="flex-1 overflow-y-auto overflow-x-hidden">
              <div className="min-w-0">{children}</div>
            </main>
            <Footer />
          </div>
        </div>
      </AuthGuard>
    </SessionProvider>
  );
}

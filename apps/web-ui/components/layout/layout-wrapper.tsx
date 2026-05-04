'use client';

import { AuthGuard } from './auth-guard';
import { AppSidebar } from './app-sidebar';
import { Header } from './header';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';

export function LayoutWrapper({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <Header />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}

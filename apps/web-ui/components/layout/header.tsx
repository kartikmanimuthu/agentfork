'use client';

import { usePathname } from 'next/navigation';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from '@/components/theme-toggle';

function getPageTitle(pathname: string) {
  if (pathname === '/dashboard') return 'Dashboard';
  if (pathname === '/sessions' || pathname.startsWith('/sessions/')) return 'Sessions';
  if (pathname === '/audit') return 'Audit Logs';
  if (pathname === '/settings') return 'Settings';
  if (pathname.startsWith('/settings/')) {
    if (pathname === '/settings/organization') return 'Organization Settings';
    if (pathname === '/settings/members') return 'Members';
    if (pathname === '/settings/roles') return 'Roles & Permissions';
    return 'Settings';
  }
  return 'AgentFork';
}

export function Header() {
  const pathname = usePathname();
  const title = getPageTitle(pathname);

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex flex-1 items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <h1 className="text-base font-semibold">{title}</h1>
      </div>
      <div className="flex items-center gap-2 px-4">
        <ThemeToggle />
      </div>
    </header>
  );
}

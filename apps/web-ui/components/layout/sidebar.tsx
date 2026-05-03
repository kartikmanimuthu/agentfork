'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import { OrgSwitcher } from '@/components/settings/org-switcher';
import {
  LayoutDashboard,
  MessageSquare,
  History,
  Settings,
  LogOut,
  User,
  Bell,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Users,
  Shield,
  UserCog,
  Globe,
  FileText,
  Activity,
} from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Chat', href: '/chat', icon: MessageSquare },
  { name: 'History', href: '/conversations', icon: History },
  { name: 'Audit Logs', href: '/audit', icon: Activity },
  { name: 'Settings', href: '/settings', icon: Settings },
];

const usersAndPermissionsNav = [
  { name: 'Members', href: '/settings/members', icon: Users },
  { name: 'Roles & Permissions', href: '/settings/roles', icon: Shield },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [usersExpanded, setUsersExpanded] = useState(false);
  const pathname = usePathname();
  const { data: session } = useSession();

  const isUsersAndPermissionsActive =
    pathname.startsWith('/settings/members') || pathname.startsWith('/settings/roles');

  const handleSignOut = () => {
    signOut({ callbackUrl: '/login' });
  };

  const getUserInitials = (name?: string | null) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div
      className={cn(
        'flex flex-col bg-card border-r border-border transition-all duration-300 overflow-hidden',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border gap-2">
        <div className={cn('flex items-center flex-1 min-w-0', collapsed && 'justify-center')}>
          <OrgSwitcher collapsed={collapsed} />
        </div>
        <div className="flex items-center space-x-1 shrink-0">
          {!collapsed && <ThemeToggle />}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className="h-8 w-8 hover:bg-accent"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const isActive =
            item.href === '/settings'
              ? pathname === '/settings' || (pathname.startsWith('/settings/') && !isUsersAndPermissionsActive)
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.name} href={item.href}>
              <Button
                variant={isActive ? 'default' : 'ghost'}
                className={cn(
                  'w-full justify-start transition-colors',
                  collapsed && 'px-2',
                  !isActive && 'hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <item.icon className={cn('h-4 w-4', !collapsed && 'mr-2')} />
                {!collapsed && item.name}
              </Button>
            </Link>
          );
        })}

        {/* Users & Permissions collapsible section */}
        {collapsed ? (
          <Link href="/settings/members">
            <Button
              variant={isUsersAndPermissionsActive ? 'default' : 'ghost'}
              className={cn(
                'w-full justify-start transition-colors px-2',
                !isUsersAndPermissionsActive && 'hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <UserCog className="h-4 w-4" />
            </Button>
          </Link>
        ) : (
          <div>
            <Button
              variant={isUsersAndPermissionsActive ? 'secondary' : 'ghost'}
              className={cn(
                'w-full justify-between transition-colors',
                !isUsersAndPermissionsActive && 'hover:bg-accent hover:text-accent-foreground',
              )}
              onClick={() => setUsersExpanded(!usersExpanded)}
            >
              <span className="flex items-center">
                <UserCog className="h-4 w-4 mr-2" />
                Members & Permissions
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform duration-200',
                  (usersExpanded || isUsersAndPermissionsActive) && 'rotate-180',
                )}
              />
            </Button>

            {(usersExpanded || isUsersAndPermissionsActive) && (
              <div className="ml-4 mt-1 space-y-1 border-l border-border pl-3">
                {usersAndPermissionsNav.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link key={item.name} href={item.href}>
                      <Button
                        variant={isActive ? 'default' : 'ghost'}
                        className={cn(
                          'w-full justify-start transition-colors text-sm',
                          !isActive && 'hover:bg-accent hover:text-accent-foreground',
                        )}
                      >
                        <item.icon className="h-3.5 w-3.5 mr-2" />
                        {item.name}
                      </Button>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* External Links */}
      <div className={cn('px-4 pb-2 space-y-1 border-t border-border pt-3', collapsed && 'px-2')}>
        <Link href="/docs">
          <Button
            variant="ghost"
            className={cn(
              'w-full justify-start text-muted-foreground hover:text-foreground',
              collapsed && 'px-2',
            )}
          >
            <FileText className={cn('h-4 w-4', !collapsed && 'mr-2')} />
            {!collapsed && 'Docs'}
          </Button>
        </Link>
      </div>

      {/* User Profile */}
      <div className="p-4 border-t border-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className={cn('w-full justify-start p-2 hover:bg-accent', collapsed && 'px-2')}
            >
              <Avatar className="h-6 w-6">
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {getUserInitials((session?.user as any)?.name)}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <div className="ml-2 text-left overflow-hidden">
                  <p className="text-sm font-medium text-foreground truncate">
                    {(session?.user as any)?.name || 'User'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {(session?.user as any)?.email || 'user@example.com'}
                  </p>
                </div>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <Link href="/settings">
              <DropdownMenuItem className="hover:bg-accent cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
            </Link>
            <DropdownMenuItem className="hover:bg-accent cursor-pointer">
              <Bell className="mr-2 h-4 w-4" />
              Notifications
            </DropdownMenuItem>
            <Link href="/settings">
              <DropdownMenuItem className="hover:bg-accent cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
            </Link>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive hover:bg-destructive/10 cursor-pointer"
              onClick={handleSignOut}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

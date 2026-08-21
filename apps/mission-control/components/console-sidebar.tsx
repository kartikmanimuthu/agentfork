'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { LogOut, ChevronRight, ChevronsUpDown, User as UserIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu,
  SidebarMenuItem, SidebarMenuButton, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton,
  SidebarHeader, SidebarFooter, useSidebar,
} from '@/components/ui/sidebar';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { topNav, bottomNav, clawStudioNav, clawStudioIcon as ClawStudioIcon, type NavItem } from '@/lib/nav-config';
import { BASE_PATH } from '@/lib/base-path';

function studioInitials(studioId: string | undefined): string {
  if (!studioId) return '?';
  return studioId.slice(0, 2).toUpperCase();
}

export function ConsoleSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { isMobile } = useSidebar();
  const studioId = session?.studio?.studioId;

  const isClawStudioActive = clawStudioNav.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const [clawStudioOpen, setClawStudioOpen] = useState(isClawStudioActive);

  const renderItem = (item: NavItem) => {
    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <SidebarMenuItem key={item.name}>
        <SidebarMenuButton
          isActive={isActive}
          tooltip={item.enabled ? item.name : `${item.name} (coming soon)`}
          onClick={() => router.push(item.href)}
        >
          <item.icon className="size-4" />
          <span>{item.name}</span>
          {!item.enabled && <span className="ml-auto text-xs text-muted-foreground">soon</span>}
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/*
          The wordmark used to be a bare div, so collapsing the rail left the
          full text in an icon-width column where it wrapped to "Miss / Cont".
          The mark is always rendered; only the wordmark is dropped when
          collapsed. Driven by the sidebar's own data attribute rather than
          React state, so there is no flash of the wrong variant on hydration.
        */}
        <div className="flex items-center gap-2 px-1 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-[11px] font-bold tracking-tight text-primary-foreground">
            MC
          </div>
          <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold">Mission Control</span>
            {studioId && (
              <span className="truncate text-[11px] text-muted-foreground">{studioId}</span>
            )}
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Claw</SidebarGroupLabel>
          <SidebarMenu>
            {topNav.map(renderItem)}

            <Collapsible open={clawStudioOpen} onOpenChange={setClawStudioOpen} className="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger
                  render={
                    <SidebarMenuButton tooltip="Claw Studio">
                      <ClawStudioIcon className="size-4" />
                      <span>Claw Studio</span>
                      {/*
                        Driven by the component's own state, not a data
                        attribute. The previous class keyed on
                        group-data-[state=open], which is Radix's contract —
                        this Collapsible is Base UI and never sets it, so the
                        chevron pointed right whether the menu was open or shut.
                      */}
                      <ChevronRight
                        className={cn(
                          'ml-auto size-4 transition-transform duration-200',
                          clawStudioOpen && 'rotate-90',
                        )}
                      />
                    </SidebarMenuButton>
                  }
                />
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {clawStudioNav.map((item) => {
                      const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <SidebarMenuSubItem key={item.name}>
                          <SidebarMenuSubButton isActive={isActive} onClick={() => router.push(item.href)}>
                            <item.icon className="size-3.5" />
                            <span>{item.name}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>

            {bottomNav.map(renderItem)}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    tooltip={studioId ?? 'Studio'}
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center"
                  >
                    {/*
                      Collapsed, the button is forced to size-8! with p-0! (see
                      sidebarMenuButtonVariants) and clips its overflow — so the
                      32px avatar, the label block and the chevron all competed
                      for 32px and the avatar came out cut off. shrink-0 keeps
                      the avatar whole; the label and chevron are dropped, since
                      neither fits and the tooltip carries the name instead.
                    */}
                    <Avatar className="h-8 w-8 shrink-0 rounded-lg">
                      <AvatarFallback className="rounded-lg border border-primary/30 bg-primary/15 text-xs font-medium text-primary backdrop-blur-sm">
                        {studioInitials(studioId)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                      <span className="truncate font-medium">{studioId ?? 'Studio'}</span>
                      <span className="truncate text-xs text-muted-foreground">Claw Studio</span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                }
              />
              <DropdownMenuContent side={isMobile ? 'bottom' : 'right'} align="end" sideOffset={4} className="min-w-56 rounded-lg">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                      <Avatar className="h-8 w-8 rounded-lg">
                        <AvatarFallback className="rounded-lg border border-primary/30 bg-primary/15 text-xs font-medium text-primary backdrop-blur-sm">
                          {studioInitials(studioId)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-medium">{studioId ?? 'Studio'}</span>
                        <span className="truncate text-xs text-muted-foreground">Claw Studio</span>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer" onClick={() => router.push('/settings')}>
                  <UserIcon className="mr-2 h-4 w-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer text-destructive" onClick={() => signOut({ callbackUrl: `${BASE_PATH}/login` })}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

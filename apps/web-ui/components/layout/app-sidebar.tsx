'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarGroup,
  SidebarGroupLabel,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { OrgSwitcher } from '@/components/settings/org-switcher';
import {
  LayoutDashboard,
  MessageSquare,
  History,
  Settings,
  Activity,
  Users,
  Shield,
  LogOut,
  User,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  Bot,
  Database,
  Plus,
  FolderOpen,
  Server,
  Sparkles,
  BarChart3,
  Zap,
  Code2,
  Palette,
  Play,
} from 'lucide-react';

const mainNav = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Audit Logs', href: '/audit', icon: Activity },
];

const analyticsNav = [
  { name: 'Dashboard', href: '/analytics', icon: BarChart3 },
  { name: 'Sessions', href: '/sessions', icon: History },
  { name: 'Inferences', href: '/inferences', icon: Zap },
];

const agentStudioNav = [
  { name: 'Agents', href: '/agents', icon: Bot },
  { name: 'MCP Servers', href: '/mcp-servers', icon: Server },
  { name: 'LLM Providers', href: '/agents/llm-providers', icon: Sparkles },
  { name: 'Playground', href: '/agents/playground', icon: MessageSquare },
];

const knowledgeBaseNav = [
  { name: 'All Bases', href: '/knowledge-bases', icon: FolderOpen },
  { name: 'Create New', href: '/knowledge-bases/new', icon: Plus },
];

const settingsNav = [
  { name: 'Overview', href: '/settings', icon: Settings },
  { name: 'Members', href: '/settings/members', icon: Users },
  { name: 'Roles & Permissions', href: '/settings/roles', icon: Shield },
];

const sdksNav = [
  { name: 'Chat Widget', href: '/sdks/chat-widget', icon: MessageSquare, children: [
    { name: 'Designer', href: '/sdks/chat-widget/designer', icon: Palette },
    { name: 'Sandbox', href: '/sdks/chat-widget/sandbox', icon: Play },
  ]},
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { isMobile } = useSidebar();

  const isSettingsActive = pathname === '/settings' || pathname.startsWith('/settings/');
  const [settingsOpen, setSettingsOpen] = useState(isSettingsActive);

  const isKbActive = pathname === '/knowledge-bases' || pathname.startsWith('/knowledge-bases/');
  const [kbOpen, setKbOpen] = useState(isKbActive);

  const isAnalyticsActive =
    pathname === '/analytics' ||
    pathname.startsWith('/analytics/') ||
    pathname === '/sessions' ||
    pathname.startsWith('/sessions/') ||
    pathname === '/inferences' ||
    pathname.startsWith('/inferences/');
  const [analyticsOpen, setAnalyticsOpen] = useState(isAnalyticsActive);

  const isAgentStudioActive = pathname === '/agents' || pathname.startsWith('/agents/') || pathname === '/mcp-servers' || pathname.startsWith('/mcp-servers/');
  const [agentStudioOpen, setAgentStudioOpen] = useState(isAgentStudioActive);

  const isSdksActive = pathname === '/sdks' || pathname.startsWith('/sdks/');
  const [sdksOpen, setSdksOpen] = useState(isSdksActive);

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
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <OrgSwitcher />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarMenu>
            {mainNav.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <SidebarMenuItem key={item.name}>
                  <SidebarMenuButton
                    isActive={isActive}
                    tooltip={item.name}
                    onClick={() => router.push(item.href)}
                  >
                    <item.icon className="size-4" />
                    <span>{item.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>


        <SidebarGroup>
          <SidebarGroupLabel>Analytics</SidebarGroupLabel>
          <SidebarMenu>
            <Collapsible open={analyticsOpen} onOpenChange={setAnalyticsOpen} className="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger
                  render={
                    <SidebarMenuButton
                      isActive={isAnalyticsActive}
                      tooltip="Analytics"
                    >
                      <BarChart3 className="size-4" />
                      <span>Analytics</span>
                      <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  }
                />
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {analyticsNav.map((item) => {
                      const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <SidebarMenuSubItem key={item.name}>
                          <SidebarMenuSubButton
                            isActive={isActive}
                            onClick={() => router.push(item.href)}
                          >
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
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Agent Studio</SidebarGroupLabel>
          <SidebarMenu>
            <Collapsible open={agentStudioOpen} onOpenChange={setAgentStudioOpen} className="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger
                  render={
                    <SidebarMenuButton
                      isActive={isAgentStudioActive}
                      tooltip="Agent Studio"
                    >
                      <Bot className="size-4" />
                      <span>Agent Studio</span>
                      <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  }
                />
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {agentStudioNav.map((item) => {
                      const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <SidebarMenuSubItem key={item.name}>
                          <SidebarMenuSubButton
                            isActive={isActive}
                            onClick={() => router.push(item.href)}
                          >
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
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Knowledge</SidebarGroupLabel>
          <SidebarMenu>
            <Collapsible open={kbOpen} onOpenChange={setKbOpen} className="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger
                  render={
                    <SidebarMenuButton
                      isActive={isKbActive}
                      tooltip="Knowledge Base"
                    >
                      <Database className="size-4" />
                      <span>Knowledge Base</span>
                      <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  }
                />
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {knowledgeBaseNav.map((item) => {
                      const isActive = pathname === item.href;
                      return (
                        <SidebarMenuSubItem key={item.name}>
                          <SidebarMenuSubButton
                            isActive={isActive}
                            onClick={() => router.push(item.href)}
                          >
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
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>SDKs</SidebarGroupLabel>
          <SidebarMenu>
            <Collapsible open={sdksOpen} onOpenChange={setSdksOpen} className="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger
                  render={
                    <SidebarMenuButton
                      isActive={isSdksActive}
                      tooltip="SDKs"
                    >
                      <Code2 className="size-4" />
                      <span>Chat Widget</span>
                      <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  }
                />
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {sdksNav[0].children.map((item) => {
                      const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <SidebarMenuSubItem key={item.name}>
                          <SidebarMenuSubButton
                            isActive={isActive}
                            onClick={() => router.push(item.href)}
                          >
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
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarMenu>
            <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen} className="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger
                  render={
                    <SidebarMenuButton
                      isActive={isSettingsActive}
                      tooltip="Settings"
                    >
                      <Settings className="size-4" />
                      <span>Settings</span>
                      <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  }
                />
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {settingsNav.map((item) => {
                      const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <SidebarMenuSubItem key={item.name}>
                          <SidebarMenuSubButton
                            isActive={isActive}
                            onClick={() => router.push(item.href)}
                          >
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
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel>Help</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Docs" onClick={() => router.push('/docs')}>
                <FileText className="size-4" />
                <span>Docs</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
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
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  >
                    <Avatar className="h-8 w-8 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-primary text-primary-foreground text-xs font-medium">
                        {getUserInitials((session?.user as any)?.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">{(session?.user as any)?.name || 'User'}</span>
                      <span className="truncate text-xs text-muted-foreground">{(session?.user as any)?.email || ''}</span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                }
              />
              <DropdownMenuContent
                side={isMobile ? 'bottom' : 'right'}
                align="end"
                sideOffset={4}
                className="min-w-56 rounded-lg"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                      <Avatar className="h-8 w-8 rounded-lg">
                        <AvatarFallback className="rounded-lg bg-primary text-primary-foreground text-xs font-medium">
                          {getUserInitials((session?.user as any)?.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-medium">{(session?.user as any)?.name || 'User'}</span>
                        <span className="truncate text-xs text-muted-foreground">{(session?.user as any)?.email || ''}</span>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer" onClick={() => router.push('/settings')}>
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive cursor-pointer"
                  onClick={() => signOut({ callbackUrl: '/login' })}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

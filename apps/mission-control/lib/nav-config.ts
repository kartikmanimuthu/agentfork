import { LayoutDashboard, MessageSquare, Sparkles, Brain, Server, Plug, Puzzle, Activity, Cpu, Bot, UserCog, CalendarClock, type LucideIcon } from 'lucide-react';

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  enabled: boolean;
}

/** Top-level nav items rendered before the Claw Studio group. */
export const topNav: NavItem[] = [
  { name: 'Mission Dashboard', href: '/dashboard', icon: LayoutDashboard, enabled: true },
  { name: 'Talk with Claw', href: '/chat', icon: MessageSquare, enabled: true },
  { name: 'Agent', href: '/agent', icon: UserCog, enabled: true },
  // Top level rather than inside the Claw Studio group: that group is collapsed by
  // default, and unattended scheduled work is a headline capability, not operational
  // tooling. Reads as "who Claw is" → "what Claw does on its own".
  { name: 'Scheduled Tasks', href: '/scheduled-tasks', icon: CalendarClock, enabled: true },
];

/** Top-level nav items rendered after the Claw Studio group. */
export const bottomNav: NavItem[] = [
  { name: 'Skills', href: '/skills', icon: Sparkles, enabled: true },
  { name: 'Memories', href: '/memory', icon: Brain, enabled: true },
  { name: 'MCP Configuration', href: '/mcp', icon: Server, enabled: true },
  { name: 'Connectors', href: '/connectors', icon: Plug, enabled: true },
  { name: 'Integrations', href: '/integrations', icon: Puzzle, enabled: true },
];

/** Children of the collapsible "Claw Studio" nav group — mirrors web-ui's Agent Studio group. */
export const clawStudioNav: NavItem[] = [
  { name: 'LLM Providers', href: '/llm-providers', icon: Cpu, enabled: true },
  { name: 'Runs', href: '/runs', icon: Activity, enabled: true },
];

export const clawStudioIcon = Bot;

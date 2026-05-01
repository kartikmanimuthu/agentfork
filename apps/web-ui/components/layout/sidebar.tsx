'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, History, Settings, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const navItems = [
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/conversations', label: 'History', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings },
];

interface SidebarProps {
  conversations?: { id: string; title: string }[];
  onNewChat?: () => void;
}

export function Sidebar({ conversations = [], onNewChat }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-muted/40">
      <div className="flex items-center justify-between border-b p-4">
        <h1 className="text-lg font-semibold">Chatbot</h1>
        <Button variant="ghost" size="icon" onClick={onNewChat} aria-label="New chat">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
              pathname === item.href && 'bg-accent text-accent-foreground',
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>
      {conversations.length > 0 && (
        <div className="border-t p-2">
          <p className="px-3 py-1 text-xs font-medium text-muted-foreground">Recent</p>
          {conversations.slice(0, 10).map((conv) => (
            <Link
              key={conv.id}
              href={`/chat?id=${conv.id}`}
              className="block truncate rounded-md px-3 py-1.5 text-sm hover:bg-accent"
            >
              {conv.title}
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}

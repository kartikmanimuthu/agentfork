'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Bot, Clock, MessageSquare } from 'lucide-react';

interface SessionDetailHeaderProps {
  session: {
    id: string;
    name: string | null;
    channel: string;
    status: string;
    endReason: string | null;
    startedAt: string;
    lastActivityAt: string;
    endedAt: string | null;
    agent: { id: string; name: string; type: string } | null;
    agentVersion: { id: string; version: number; status: string } | null;
  };
  messageCount: number;
  firstUserQuery: string | null;
  onBack: () => void;
}

export function SessionDetailHeader({ session, messageCount, firstUserQuery, onBack }: SessionDetailHeaderProps) {
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  const duration = () => {
    const start = new Date(session.startedAt).getTime();
    const end = session.endedAt
      ? new Date(session.endedAt).getTime()
      : new Date(session.lastActivityAt).getTime();
    const diffMs = end - start;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return '<1 min';
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  const title = firstUserQuery || session.name || 'Untitled session';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight truncate">{title}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="text-xs">{session.channel}</Badge>
          <Badge variant={session.status === 'active' ? 'default' : 'secondary'} className="text-xs">
            {session.status}{session.endReason ? ` · ${session.endReason}` : ''}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground pl-11">
        {session.agent && (
          <span className="flex items-center gap-1">
            <Bot className="h-3 w-3" />
            {session.agent.name}
            {session.agentVersion ? ` v${session.agentVersion.version}` : ''}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDate(session.startedAt)} · {duration()}
        </span>
        <span className="flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {messageCount} messages
        </span>
      </div>
    </div>
  );
}

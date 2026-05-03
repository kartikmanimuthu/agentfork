'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { MessageSquare, Trash2 } from 'lucide-react';
import { formatShortDateTime, useTenantTimezone } from '@/lib/date-utils';

interface Conversation {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const timezone = useTenantTimezone();

  useEffect(() => {
    fetch('/api/conversations?limit=50')
      .then((res) => res.json())
      .then((data) => {
        setConversations(data.items ?? []);
        setLoading(false);
      });
  }, []);

  const handleDelete = async (id: string) => {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    setConversations((prev) => prev.filter((c) => c.id !== id));
  };

  if (loading) {
    return <div className="flex items-center justify-center p-8">Loading...</div>;
  }

  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Conversation History</h2>
      {conversations.length === 0 ? (
        <p className="text-muted-foreground">No conversations yet. Start a new chat.</p>
      ) : (
        <div className="space-y-2">
          {conversations.map((conv) => (
            <div key={conv.id} className="flex items-center justify-between rounded-md border p-3">
              <Link href={`/chat?id=${conv.id}`} className="flex items-center gap-3 flex-1">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{conv.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {conv.messageCount} messages &middot; {formatShortDateTime(conv.updatedAt, timezone)}
                  </p>
                </div>
              </Link>
              <Button variant="ghost" size="icon" onClick={() => handleDelete(conv.id)} aria-label="Delete conversation">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

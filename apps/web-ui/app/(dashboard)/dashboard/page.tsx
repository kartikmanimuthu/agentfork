'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  MessageSquare,
  MessagesSquare,
  Users,
  HardDrive,
  ArrowRight,
  Plus,
  Settings,
  Clock,
} from 'lucide-react';
import { formatShortDateTime, useTenantTimezone } from '@/lib/date-utils';

interface Conversation {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

interface DashboardStats {
  totalConversations: number;
  totalMessages: number;
  activeUsers: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentConversations, setRecentConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const timezone = useTenantTimezone();

  useEffect(() => {
    async function fetchData() {
      try {
        const [convRes] = await Promise.all([fetch('/api/conversations?limit=50')]);
        const convData = convRes.ok ? await convRes.json() : { items: [] };
        const conversations = Array.isArray(convData) ? convData : convData.items ?? [];

        const totalMessages = conversations.reduce(
          (sum: number, c: Conversation) => sum + (c.messageCount || 0),
          0,
        );

        setStats({
          totalConversations: conversations.length,
          totalMessages,
          activeUsers: 1,
        });

        setRecentConversations(conversations.slice(0, 5));
      } catch (e) {
        console.error('Dashboard fetch error:', e);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const formatDateLocal = (dateStr: string) => formatShortDateTime(dateStr, timezone);

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">Overview of your chatbot activity and usage.</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Conversations</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{stats?.totalConversations ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Messages</CardTitle>
            <MessagesSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{stats?.totalMessages ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground">Across all conversations</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{stats?.activeUsers ?? 1}</div>
            )}
            <p className="text-xs text-muted-foreground">In your organization</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Storage</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-muted-foreground">Coming soon</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/chat">
          <Button className="w-full justify-start gap-2" variant="outline">
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </Link>
        <Link href="/conversations">
          <Button className="w-full justify-start gap-2" variant="outline">
            <MessageSquare className="h-4 w-4" />
            View History
          </Button>
        </Link>
        <Link href="/settings">
          <Button className="w-full justify-start gap-2" variant="outline">
            <Settings className="h-4 w-4" />
            Settings
          </Button>
        </Link>
      </div>

      {/* Recent Conversations */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Conversations</CardTitle>
          <CardDescription>Your latest chat sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : recentConversations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No conversations yet. Start a new chat to see it here.</p>
          ) : (
            <div className="space-y-2">
              {recentConversations.map((conv) => (
                <Link
                  key={conv.id}
                  href={`/chat?id=${conv.id}`}
                  className="flex items-center justify-between rounded-md border p-3 hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{conv.title || 'Untitled'}</p>
                      <p className="text-xs text-muted-foreground">
                        {conv.messageCount} messages
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary" className="text-xs">
                      <Clock className="h-3 w-3 mr-1" />
                      {formatDateLocal(conv.updatedAt)}
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

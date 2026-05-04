'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { ActivityChart } from '@/components/dashboard/activity-chart';

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

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [allConversations, setAllConversations] = useState<Conversation[]>([]);
  const [recentConversations, setRecentConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [convRes] = await Promise.all([fetch('/api/conversations?limit=50')]);
        const convData = convRes.ok ? await convRes.json() : { items: [] };
        const conversations: Conversation[] = convData.items ?? [];

        const totalMessages = conversations.reduce(
          (sum: number, c: Conversation) => sum + (c.messageCount || 0),
          0,
        );

        setStats({
          totalConversations: conversations.length,
          totalMessages,
          activeUsers: 1,
        });

        setAllConversations(conversations);
        setRecentConversations(conversations.slice(0, 5));
      } catch (e) {
        console.error('Dashboard fetch error:', e);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const statCards = [
    {
      label: 'Total Conversations',
      value: stats?.totalConversations ?? 0,
      sublabel: 'All time',
      icon: MessageSquare,
    },
    {
      label: 'Total Messages',
      value: stats?.totalMessages ?? 0,
      sublabel: 'Across all conversations',
      icon: MessagesSquare,
    },
    {
      label: 'Active Users',
      value: stats?.activeUsers ?? 1,
      sublabel: 'In your organization',
      icon: Users,
    },
    {
      label: 'Storage',
      value: '—',
      sublabel: 'Coming soon',
      icon: HardDrive,
    },
  ];

  return (
    <div className="flex-1 space-y-8 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground mt-1">Overview of your chatbot activity and usage.</p>
        </div>
      </div>

      {/* Stats Cards */}
      <motion.div
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {statCards.map((stat) => (
          <motion.div key={stat.label} variants={itemVariants}>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
                <stat.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-2xl font-bold">{stat.value}</div>
                )}
                <p className="text-xs text-muted-foreground mt-1">{stat.sublabel}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {/* Quick Actions */}
      <motion.div
        className="grid gap-4 md:grid-cols-3"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {[
          { href: '/chat', icon: Plus, label: 'New Chat', desc: 'Start a conversation' },
          { href: '/conversations', icon: MessageSquare, label: 'View History', desc: 'Browse past chats' },
          { href: '/settings', icon: Settings, label: 'Settings', desc: 'Manage preferences' },
        ].map((action) => (
          <motion.div key={action.label} variants={itemVariants} whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
            <Link href={action.href} className="block">
              <Card className="hover:bg-accent/50 transition-colors cursor-pointer h-full">
                <CardContent className="flex items-center gap-4 p-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <action.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{action.label}</p>
                    <p className="text-xs text-muted-foreground">{action.desc}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </motion.div>
        ))}
      </motion.div>

      {/* Activity Chart */}
      <motion.div variants={containerVariants} initial="hidden" animate="visible">
        <motion.div variants={itemVariants}>
          <ActivityChart conversations={allConversations} />
        </motion.div>
      </motion.div>

      {/* Recent Conversations */}
      <motion.div variants={containerVariants} initial="hidden" animate="visible">
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle>Recent Conversations</CardTitle>
              <CardDescription>Your latest chat sessions.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : recentConversations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No conversations yet. Start a new chat to see it here.
                </p>
              ) : (
                <div className="space-y-3">
                  {recentConversations.map((conv) => (
                    <Link
                      key={conv.id}
                      href={`/chat?id=${conv.id}`}
                      className="flex items-center justify-between rounded-lg border p-4 hover:bg-accent transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground shrink-0">
                          <MessageSquare className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{conv.title || 'Untitled'}</p>
                          <p className="text-xs text-muted-foreground">{conv.messageCount} messages</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Badge variant="secondary" className="text-xs font-normal">
                          <Clock className="h-3 w-3 mr-1" />
                          {formatDate(conv.updatedAt)}
                        </Badge>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </div>
  );
}

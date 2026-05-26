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
  History,
  Settings,
  Clock,
  Bot,
} from 'lucide-react';
import { ActivityChart } from '@/components/dashboard/activity-chart';
import { formatShortDateTime, useTenantTimezone } from '@/lib/date-utils';

interface Session {
  id: string;
  name: string | null;
  channel: string;
  status: string;
  messageCount: number;
  startedAt: string;
  lastActivityAt: string;
  agent: { id: string; name: string; type: string } | null;
}

interface DashboardStats {
  totalSessions: number;
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
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [recentSessions, setRecentSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const timezone = useTenantTimezone();

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/sessions?limit=50');
        const data = res.ok ? await res.json() : { sessions: [] };
        const sessions: Session[] = data.sessions ?? [];

        const totalMessages = sessions.reduce((sum, s) => sum + (s.messageCount || 0), 0);

        setStats({
          totalSessions: sessions.length,
          totalMessages,
          activeUsers: 1,
        });

        setAllSessions(sessions);
        setRecentSessions(sessions.slice(0, 5));
      } catch (e) {
        console.error('Dashboard fetch error:', e);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const formatDateLocal = (dateStr: string) => {
    if (!dateStr) return 'Unknown';
    return formatShortDateTime(dateStr, timezone);
  };

  const statCards = [
    {
      label: 'Total Sessions',
      value: stats?.totalSessions ?? 0,
      sublabel: 'All time',
      icon: MessageSquare,
    },
    {
      label: 'Total Messages',
      value: stats?.totalMessages ?? 0,
      sublabel: 'Across all sessions',
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
          <p className="text-muted-foreground mt-1">Overview of inference activity across your agents.</p>
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
          { href: '/agents', icon: Bot, label: 'Agents', desc: 'Manage and configure agents' },
          { href: '/sessions', icon: History, label: 'Sessions', desc: 'Browse inference sessions' },
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
          <ActivityChart
            items={allSessions.map((s) => ({ id: s.id, updatedAt: s.lastActivityAt }))}
          />
        </motion.div>
      </motion.div>

      {/* Recent Sessions */}
      <motion.div variants={containerVariants} initial="hidden" animate="visible">
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle>Recent Sessions</CardTitle>
              <CardDescription>Your latest inference sessions.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : recentSessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No sessions yet. Sessions are created when integrators call <code>/api/v1/inference</code> with a{' '}
                  <code>sessionId</code>.
                </p>
              ) : (
                <div className="space-y-3">
                  {recentSessions.map((s) => (
                    <Link
                      key={s.id}
                      href={`/sessions/${s.id}`}
                      className="flex items-center justify-between rounded-lg border p-4 hover:bg-accent transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground shrink-0">
                          <MessageSquare className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {s.name ?? s.agent?.name ?? 'Untitled session'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {s.messageCount} messages · {s.channel}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Badge variant="secondary" className="text-xs font-normal">
                          <Clock className="h-3 w-3 mr-1" />
                          {formatDateLocal(s.lastActivityAt)}
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

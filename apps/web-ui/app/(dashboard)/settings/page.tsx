'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ThemeSettings } from '@/components/settings/theme-settings';
import { ProfileForm } from '@/components/settings/profile-form';
import { NotificationsForm } from '@/components/settings/notifications-form';
import { SecuritySettings } from '@/components/settings/security-settings';
import { Button } from '@/components/ui/button';
import { Settings, Palette, Bell, Shield, User, Building2, ArrowRight, Users, ChevronRight, Send } from 'lucide-react';
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';
import Link from 'next/link';
import { motion } from 'framer-motion';

const tabVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' as const } },
};

export default function SettingsPage() {
  return (
    <div className="flex-1 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
            <p className="text-sm text-muted-foreground">Manage your account and application preferences.</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="appearance" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 lg:grid-cols-5 h-auto p-1 bg-muted/60">
          <TabsTrigger value="appearance" className="gap-2 py-2.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Palette className="h-4 w-4 hidden sm:inline" />
            <span>Appearance</span>
          </TabsTrigger>
          <TabsTrigger value="profile" className="gap-2 py-2.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <User className="h-4 w-4 hidden sm:inline" />
            <span>Profile</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2 py-2.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Bell className="h-4 w-4 hidden sm:inline" />
            <span>Notifications</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2 py-2.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Shield className="h-4 w-4 hidden sm:inline" />
            <span>Security</span>
          </TabsTrigger>
          <TabsTrigger value="organization" className="gap-2 py-2.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Building2 className="h-4 w-4 hidden sm:inline" />
            <span>Organization</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="appearance" className="space-y-4">
          <motion.div initial="hidden" animate="visible" variants={tabVariants}>
            <ThemeSettings />
          </motion.div>
        </TabsContent>

        <TabsContent value="profile" className="space-y-4">
          <motion.div initial="hidden" animate="visible" variants={tabVariants}>
            <Card>
              <CardHeader>
                <CardTitle>Profile Settings</CardTitle>
                <CardDescription>Manage your profile information and preferences.</CardDescription>
              </CardHeader>
              <CardContent>
                <ProfileForm />
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <motion.div initial="hidden" animate="visible" variants={tabVariants}>
            <Card>
              <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
                <CardDescription>Configure how you receive notifications.</CardDescription>
              </CardHeader>
              <CardContent>
                <NotificationsForm />
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <motion.div initial="hidden" animate="visible" variants={tabVariants}>
            <SecuritySettings />
          </motion.div>
        </TabsContent>

        <TabsContent value="organization" className="space-y-4">
          <motion.div initial="hidden" animate="visible" variants={tabVariants}>
            <div className="grid gap-4">
              <Card className="hover:bg-accent/30 transition-colors">
                <Link href="/settings/organization" className="block">
                  <CardContent className="flex items-center justify-between p-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Building2 className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Organization Settings</p>
                        <p className="text-xs text-muted-foreground">Update name, timezone, and notification preferences.</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Link>
              </Card>

              <Card className="hover:bg-accent/30 transition-colors">
                <Link href="/settings/members" className="block">
                  <CardContent className="flex items-center justify-between p-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Users className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Members</p>
                        <p className="text-xs text-muted-foreground">Manage team members and invitations.</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Link>
              </Card>

              <Card className="hover:bg-accent/30 transition-colors">
                <Link href="/settings/roles" className="block">
                  <CardContent className="flex items-center justify-between p-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Shield className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Roles & Permissions</p>
                        <p className="text-xs text-muted-foreground">Configure role-based access control.</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Link>
              </Card>

              <Card className="hover:bg-accent/30 transition-colors">
                <Link href="/settings/channels/whatsapp" className="block">
                  <CardContent className="flex items-center justify-between p-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10 text-green-600">
                        <WhatsAppIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">WhatsApp Channels</p>
                        <p className="text-xs text-muted-foreground">Connect and manage WhatsApp Business accounts.</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Link>
              </Card>

              <Card className="hover:bg-accent/30 transition-colors">
                <Link href="/settings/channels/telegram" className="block">
                  <CardContent className="flex items-center justify-between p-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600">
                        <Send className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">Telegram Channels</p>
                        <p className="text-xs text-muted-foreground">Connect and manage Telegram bots.</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Link>
              </Card>
            </div>
          </motion.div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

'use client';

import { Settings, Palette, Bell, Shield, User } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ThemeSettings } from '@/components/settings/theme-settings';
import { ProfileInfo } from '@/components/settings/profile-info';
import { NotificationsForm } from '@/components/settings/notifications-form';
import { SecuritySettings } from '@/components/settings/security-settings';

const tabVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' as const } },
};

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 md:p-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
            <p className="text-sm text-muted-foreground">Manage your Studio account and Mission Control preferences.</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="appearance" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto p-1 bg-muted/60">
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
                <CardDescription>Your Claw Studio account information.</CardDescription>
              </CardHeader>
              <CardContent>
                <ProfileInfo />
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
      </Tabs>
    </div>
  );
}

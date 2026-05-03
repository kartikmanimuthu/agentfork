'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ThemeSettings } from '@/components/settings/theme-settings';
import { ProfileForm } from '@/components/settings/profile-form';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useRouter } from 'next/navigation';
import { Settings, Palette, Bell, Shield, User, Building2 } from 'lucide-react';

export default function SettingsPage() {
  const router = useRouter();

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
      <div className="flex items-center space-x-2">
        <Settings className="h-6 w-6" />
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
      </div>
      <p className="text-muted-foreground">Manage your account settings and application preferences.</p>

      <Tabs defaultValue="appearance" className="space-y-4">
        <TabsList className="bg-muted">
          <TabsTrigger value="appearance" className="data-[state=active]:bg-background">
            <Palette className="mr-2 h-4 w-4" />
            Appearance
          </TabsTrigger>
          <TabsTrigger value="profile" className="data-[state=active]:bg-background">
            <User className="mr-2 h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="notifications" className="data-[state=active]:bg-background">
            <Bell className="mr-2 h-4 w-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="security" className="data-[state=active]:bg-background">
            <Shield className="mr-2 h-4 w-4" />
            Security
          </TabsTrigger>
          <TabsTrigger
            value="organization"
            className="data-[state=active]:bg-background"
            onClick={() => router.push('/settings/organization')}
          >
            <Building2 className="mr-2 h-4 w-4" />
            Organization
          </TabsTrigger>
        </TabsList>

        <TabsContent value="appearance" className="space-y-4">
          <ThemeSettings />
        </TabsContent>

        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Profile Settings</CardTitle>
              <CardDescription>Manage your profile information and preferences.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <ProfileForm />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>Configure how you receive notifications.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="email-notifications">Email Notifications</Label>
                  <p className="text-sm text-muted-foreground">Receive updates via email.</p>
                </div>
                <Switch id="email-notifications" />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="push-notifications">Push Notifications</Label>
                  <p className="text-sm text-muted-foreground">Receive push notifications in browser.</p>
                </div>
                <Switch id="push-notifications" />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="marketing-emails">Marketing Emails</Label>
                  <p className="text-sm text-muted-foreground">Receive product updates and offers.</p>
                </div>
                <Switch id="marketing-emails" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Security Settings</CardTitle>
              <CardDescription>Manage your security preferences and access controls.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Security settings will be implemented here.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

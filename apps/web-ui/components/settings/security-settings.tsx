'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Shield, KeyRound, Smartphone, LogOut } from 'lucide-react';

export function SecuritySettings() {
  const [twoFactor, setTwoFactor] = useState(false);
  const [sessionAlerts, setSessionAlerts] = useState(true);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Authentication</CardTitle>
          <CardDescription>Manage how you sign in to your account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                <Label>Password</Label>
              </div>
              <p className="text-sm text-muted-foreground">Last changed 3 months ago.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => toast.info('Password change coming soon')}>
              Change Password
            </Button>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-muted-foreground" />
                <Label>Two-Factor Authentication</Label>
              </div>
              <p className="text-sm text-muted-foreground">Add an extra layer of security.</p>
            </div>
            <Switch checked={twoFactor} onCheckedChange={setTwoFactor} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>Manage your active sessions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Current Session</p>
              <p className="text-sm text-muted-foreground">Started on this device just now.</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-xs text-muted-foreground">Active</span>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Session Alerts</Label>
              <p className="text-sm text-muted-foreground">Get notified of new sign-ins.</p>
            </div>
            <Switch checked={sessionAlerts} onCheckedChange={setSessionAlerts} />
          </div>

          <div className="pt-2">
            <Button variant="destructive" size="sm" onClick={() => toast.info('Sign out all sessions coming soon')}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out All Sessions
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

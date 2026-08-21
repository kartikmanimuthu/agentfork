'use client';

import { Bot, Hash, Calendar, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useStudioProfile } from '@/hooks/use-studio-profile';

function Row({ icon: Icon, label, value }: { icon: typeof Hash; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{value}</p>
      </div>
    </div>
  );
}

export function ProfileInfo() {
  const { data: profile, isLoading } = useStudioProfile();

  if (isLoading || !profile) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          There's no separate name or email here — {profile.studioId} and its password are the entire login.
        </p>
        <Badge variant={profile.status === 'active' ? 'secondary' : 'outline'} className="capitalize">
          {profile.status}
        </Badge>
      </div>
      <Separator />
      <Row icon={Hash} label="Studio ID" value={profile.studioId} />
      <Separator />
      <Row icon={Bot} label="Claw" value={profile.claw?.name ?? 'Not provisioned'} />
      <Separator />
      <Row
        icon={Clock}
        label="Last login"
        value={profile.lastLoginAt ? new Date(profile.lastLoginAt).toLocaleString() : 'Never'}
      />
      <Separator />
      <Row icon={Calendar} label="Created" value={new Date(profile.createdAt).toLocaleDateString()} />
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Org {
  id: string;
  name: string;
  slug: string | null;
  role: string | null;
  logoUrl: string | null;
}

interface OrgSwitcherProps {
  collapsed: boolean;
}

export function OrgSwitcher({ collapsed }: OrgSwitcherProps) {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);

  const currentTenantId = session?.user?.tenantId as string | undefined;

  const fetchOrgs = useCallback(async () => {
    try {
      const res = await fetch('/api/tenants/my-orgs');
      if (res.ok) {
        const data = await res.json();
        setOrgs(data.orgs ?? []);
      }
    } catch (err) {
      console.error('Failed to fetch orgs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  const handleSwitch = async (tenantId: string) => {
    if (tenantId === currentTenantId) return;
    try {
      const res = await fetch('/api/tenants/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      if (!res.ok) return;
      await update();
      router.refresh();
    } catch (err) {
      console.error('Failed to switch org:', err);
    }
  };

  const currentOrg = orgs.find((o) => o.id === currentTenantId);
  const isMultiOrg = orgs.length > 1;

  const getOrgInitial = (name: string) => name.charAt(0).toUpperCase();

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="w-8 h-8 rounded-md bg-muted animate-pulse" />
        {!collapsed && <div className="h-4 w-24 bg-muted animate-pulse rounded" />}
      </div>
    );
  }

  if (!currentOrg) return null;

  const createOrgItem = (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => router.push('/create-org')}
        className="flex items-center gap-2 cursor-pointer"
      >
        <div className="h-6 w-6 rounded-md border border-dashed border-muted-foreground/50 flex items-center justify-center shrink-0">
          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <span className="text-sm text-muted-foreground">Create new organization</span>
      </DropdownMenuItem>
    </>
  );

  if (!isMultiOrg) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-md w-full',
              'hover:bg-accent transition-colors text-left',
            )}
          >
            <Avatar className="h-8 w-8 rounded-md shrink-0">
              <AvatarImage src={currentOrg.logoUrl ?? undefined} alt={currentOrg.name} />
              <AvatarFallback className="rounded-md bg-primary text-primary-foreground text-xs font-medium">
                {getOrgInitial(currentOrg.name)}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <>
                <span className="font-semibold text-sm truncate flex-1">
                  {currentOrg.name}
                </span>
                <ChevronsUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            Organization
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="flex items-center gap-2">
            <Avatar className="h-6 w-6 rounded-md shrink-0">
              <AvatarImage src={currentOrg.logoUrl ?? undefined} alt={currentOrg.name} />
              <AvatarFallback className="rounded-md bg-muted text-muted-foreground text-xs">
                {getOrgInitial(currentOrg.name)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate flex-1 text-sm">{currentOrg.name}</span>
            <Check className="h-4 w-4 text-primary shrink-0" />
          </DropdownMenuItem>
          {createOrgItem}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-2 px-2 py-1.5 rounded-md w-full',
            'hover:bg-accent transition-colors text-left',
          )}
        >
          <Avatar className="h-8 w-8 rounded-md shrink-0">
            <AvatarImage src={currentOrg.logoUrl ?? undefined} alt={currentOrg.name} />
            <AvatarFallback className="rounded-md bg-primary text-primary-foreground text-xs font-medium">
              {getOrgInitial(currentOrg.name)}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <>
              <span className="font-semibold text-sm truncate flex-1">
                {currentOrg.name}
              </span>
              <ChevronsUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          Switch organization
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orgs.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => handleSwitch(org.id)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <Avatar className="h-6 w-6 rounded-md shrink-0">
              <AvatarImage src={org.logoUrl ?? undefined} alt={org.name} />
              <AvatarFallback className="rounded-md bg-muted text-muted-foreground text-xs">
                {getOrgInitial(org.name)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate flex-1 text-sm">{org.name}</span>
            {org.id === currentTenantId && (
              <Check className="h-4 w-4 text-primary shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
        {createOrgItem}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

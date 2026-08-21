'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { type AgentSummaryDTO } from '@/hooks/use-agent-summary';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/** Counts link out to the pages that own them rather than duplicating their UI
 *  here — one place to manage each thing, one place to see everything. */
function CountTile({
  label, value, href, hint,
}: {
  label: string;
  value: string;
  href: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border p-4 transition-colors hover:bg-accent/50"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </Link>
  );
}

export function AgentOverview({
  summary,
  isLoading,
  identityContent,
}: {
  summary: AgentSummaryDTO | undefined;
  isLoading: boolean;
  identityContent: string | undefined;
}) {
  if (isLoading || !summary) {
    return <Skeleton className="h-72 w-full" />;
  }

  // IDENTITY.md is `key: value` lines by convention, so a light parse gives the
  // name/role without imposing a schema on a file the user (or Claw) may rewrite.
  const identity = Object.fromEntries(
    (identityContent ?? '')
      .split('\n')
      .map((line) => line.match(/^\s*([a-zA-Z]+)\s*:\s*(.+?)\s*$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [m[1].toLowerCase(), m[2]]),
  ) as Record<string, string>;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agent Context</CardTitle>
            <CardDescription>Identity and scheduling targets.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Field label="Identity Name">{identity.name || <span className="text-muted-foreground">—</span>}</Field>
            <Field label="Role">{identity.role || <span className="text-muted-foreground">—</span>}</Field>
            <Field label="Primary Model">
              {summary.provider?.chatModel
                ? <span className="break-all font-mono text-xs">{summary.provider.chatModel}</span>
                : <span className="text-muted-foreground">Not configured</span>}
            </Field>
            <Field label="Provider">
              {summary.provider
                ? summary.provider.name
                : <span className="text-muted-foreground">—</span>}
            </Field>
            <Field label="Emoji">{identity.emoji || <span className="text-muted-foreground">—</span>}</Field>
            <Field label="Auto-approve">
              {summary.autoApprove
                ? <Badge variant="secondary">On</Badge>
                : <span className="text-muted-foreground">Off</span>}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Channels</CardTitle>
            <CardDescription>Where Claw can be reached.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.channels.length === 0 ? (
              <p className="text-sm text-muted-foreground">No connectors registered.</p>
            ) : (
              summary.channels.map((channel) => (
                <div key={channel.channel} className="flex items-center justify-between text-sm">
                  <span>{channel.displayName}</span>
                  {channel.enabled ? (
                    <Badge variant="secondary">Enabled</Badge>
                  ) : channel.configured ? (
                    <span className="text-xs text-muted-foreground">Configured, off</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not set up</span>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CountTile
          label="Skills"
          value={`${summary.skills.enabled}/${summary.skills.total}`}
          href="/skills"
          hint="enabled of total"
        />
        <CountTile
          label="Memories"
          value={String(summary.memories)}
          href="/memory"
          hint="learned across sessions"
        />
        <CountTile
          label="Tool servers"
          value={`${summary.mcp.active}/${summary.mcp.total}`}
          href="/mcp"
          hint="active MCP connections"
        />
        <CountTile
          label="Connectors"
          value={String(summary.channelsEnabled)}
          href="/connectors"
          hint="channels enabled"
        />
      </div>
    </div>
  );
}

'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgentTools } from '@/hooks/use-agent-summary';

export function AgentTools({ active }: { active: boolean }) {
  const { data, isLoading, error } = useAgentTools(active);

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-6 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load tools.'}
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;

  const total = data.reduce((sum, group) => sum + group.tools.length, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tools</CardTitle>
        <CardDescription>
          What Claw can actually do right now — {total} tool{total === 1 ? '' : 's'} bound.
          Tools marked <span className="font-medium">approval</span> pause a run until you confirm.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {data.map((group) => (
          <div key={group.source} className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.displayName}
              </p>
              {group.tools.length > 0 && (
                <span className="text-xs text-muted-foreground/70">{group.tools.length}</span>
              )}
            </div>

            {group.note && <p className="text-sm text-muted-foreground">{group.note}</p>}

            {group.tools.length > 0 && (
              <div className="divide-y rounded-md border">
                {group.tools.map((tool) => (
                  <div key={tool.name} className="flex items-start justify-between gap-4 px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-mono text-xs">{tool.name}</p>
                      {tool.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{tool.description}</p>
                      )}
                    </div>
                    {tool.mutative && (
                      <Badge variant="outline" className="shrink-0">approval</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

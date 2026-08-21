'use client';

import { useState } from 'react';
import { Bot } from 'lucide-react';
import { PageHeaderTitle } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { useAgentSummary } from '@/hooks/use-agent-summary';
import { useWorkspaceFiles } from '@/hooks/use-workspace-files';
import { AgentOverview } from './agent-overview';
import { AgentTools } from './agent-tools';
import { CoreFilesCard } from './core-files-card';
import { UnderlineTabsList, UnderlineTabsTrigger } from './underline-tabs';

export function WorkspaceFilesClient() {
  const [tab, setTab] = useState('files');
  const files = useWorkspaceFiles();
  const summary = useAgentSummary();

  const identityContent = files.data?.find((f) => f.slug === 'identity')?.content;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeaderTitle icon={Bot} title="Agent" description="Workspace, tools, identity." />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <UnderlineTabsList className="mb-6">
          <UnderlineTabsTrigger value="overview">Overview</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="files" count={files.data?.length}>Files</UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="tools">Tools</UnderlineTabsTrigger>
        </UnderlineTabsList>

        <TabsContent value="overview" className="mt-0">
          <AgentOverview
            summary={summary.data}
            isLoading={summary.isLoading}
            identityContent={identityContent}
          />
        </TabsContent>

        <TabsContent value="files" className="mt-0">
          {files.error ? (
            <Card className="border-destructive/40">
              <CardContent className="p-6 text-sm text-destructive">
                {files.error instanceof Error ? files.error.message : 'Failed to load workspace files.'}
              </CardContent>
            </Card>
          ) : files.isLoading ? (
            <Skeleton className="h-96 w-full" />
          ) : !files.data?.length ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No workspace files yet.
              </CardContent>
            </Card>
          ) : (
            <CoreFilesCard files={files.data} />
          )}
        </TabsContent>

        <TabsContent value="tools" className="mt-0">
          <AgentTools active={tab === 'tools'} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

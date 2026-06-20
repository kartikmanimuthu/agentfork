'use client';

import { useParams, useRouter } from 'next/navigation';
import { useAgent } from '@/hooks/use-agents';
import { useAgentVersions, usePublishAgent } from '@/hooks/use-agent-versions';
import { AgentCanvas } from '@/components/agents/canvas/agent-canvas';
import { SimpleAgentForm } from '@/components/agents/config/simple-agent-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Bot, Settings, ArrowLeft, Play } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useState, useEffect } from 'react';
import type { GraphNode, GraphEdge, SimpleAgentConfig } from '@chatbot/agent-studio';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { McpServersTab } from '@/components/agents/tabs/mcp-servers-tab';
import { ToolsTab } from '@/components/agents/tabs/tools-tab';
import { GuardrailsTab } from '@/components/agents/tabs/guardrails-tab';
import { KnowledgeBasesTab } from '@/components/agents/tabs/knowledge-bases-tab';
import { VersionsTab } from '@/components/agents/tabs/versions-tab';
import { AliasManager } from '@/components/agents/tabs/alias-manager';
import { useApiKeys } from '@/hooks/use-api-keys';
import { ApiKeyTable } from '@/components/api-keys/api-key-table';
import { CreateKeyDialog } from '@/components/api-keys/create-key-dialog';

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const agentId = params.id;

  const { data: agent, isLoading, error, refetch } = useAgent(agentId);
  const { data: versions } = useAgentVersions(agentId);
  const publishMutation = usePublishAgent(agentId);
  const [saving, setSaving] = useState(false);

  const { keys, loading: keysLoading, fetchKeys, createKey, revokeKey } = useApiKeys(agentId);
  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  if (isLoading) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <p className="text-muted-foreground">Agent not found.</p>
          <Button variant="outline" onClick={() => router.push('/agents')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Agents
          </Button>
        </div>
      </div>
    );
  }

  // ─── Graph agent: full-height canvas ──────────────────────────────────────

  if (agent.type === 'graph') {
    const graphConfig = agent.config as { nodes?: GraphNode[]; edges?: GraphEdge[] };
    const initialNodes: GraphNode[] = graphConfig.nodes ?? [];
    const initialEdges: GraphEdge[] = graphConfig.edges ?? [];

    const handleSave = async (nodes: GraphNode[], edges: GraphEdge[]) => {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { nodes, edges } }),
      });
      if (!res.ok) throw new Error('Failed to save');
      await fetch(`/api/agents/${agentId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { nodes, edges } }),
      });
      refetch();
    };

    const handlePublish = async () => {
      const latestVersion = versions?.[0];
      if (!latestVersion) {
        toast.error('No version available to publish');
        return;
      }
      await publishMutation.mutateAsync(latestVersion.id);
    };

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 py-2 border-b bg-background shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            nativeButton={false}
            render={<Link href="/agents" aria-label="Back to agents" />}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Bot className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{agent.name}</span>
          <Badge variant="outline" className="capitalize text-[10px]">{agent.status}</Badge>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            nativeButton={false}
            render={<Link href={`/agents/${agentId}/playground`} aria-label="Open playground" />}
          >
            <Play className="h-4 w-4 mr-1" />
            Playground
          </Button>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href={`/agents/${agentId}/api-keys`} aria-label="API Keys" />}
          >
            API Keys
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 ml-auto"
            nativeButton={false}
            render={<Link href={`/agents/${agentId}/settings`} aria-label="Agent settings" />}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
        <AgentCanvas
          agentId={agentId}
          agentName={agent.name}
          agentConfig={agent.config as Record<string, unknown>}
          initialNodes={initialNodes}
          initialEdges={initialEdges}
          onSave={handleSave}
          onPublish={handlePublish}
        />
      </div>
    );
  }

  // ─── Simple agent: form layout ─────────────────────────────────────────────

  const simpleConfig = agent.config as unknown as SimpleAgentConfig;

  const handleSimpleSave = async (config: SimpleAgentConfig) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) throw new Error('Failed to save');
      await fetch(`/api/agents/${agentId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      toast.success('Agent saved');
      refetch();
    } catch {
      toast.error('Failed to save agent');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          nativeButton={false}
          render={<Link href="/agents" aria-label="Back to agents" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Bot className="h-5 w-5" />
        <h2 className="text-2xl font-bold tracking-tight">{agent.name}</h2>
        <Badge variant="outline" className="capitalize">{agent.status}</Badge>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          nativeButton={false}
          render={<Link href={`/agents/${agentId}/playground`} aria-label="Open playground" />}
        >
          <Play className="h-4 w-4 mr-1" />
          Playground
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 ml-auto"
          nativeButton={false}
          render={<Link href={`/agents/${agentId}/settings`} aria-label="Agent settings" />}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      {agent.description && (
        <p className="text-muted-foreground">{agent.description}</p>
      )}

      <Tabs defaultValue="configuration" className="space-y-4">
        <TabsList>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
          <TabsTrigger value="knowledge-bases">Knowledge Bases</TabsTrigger>
          <TabsTrigger value="mcp-servers">MCP Servers</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="guardrails">Guardrails</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
        </TabsList>
        <TabsContent value="configuration">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>Configure the model and system prompt for this agent.</CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleAgentForm
                config={simpleConfig}
                onSave={handleSimpleSave}
                saving={saving}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="knowledge-bases">
          <KnowledgeBasesTab agentId={agentId} agentConfig={agent.config as Record<string, unknown>} />
        </TabsContent>
        <TabsContent value="mcp-servers">
          <McpServersTab agentId={agentId} agentConfig={agent.config as Record<string, unknown>} />
        </TabsContent>
        <TabsContent value="tools">
          <ToolsTab
            config={simpleConfig}
            onSave={handleSimpleSave}
            saving={saving}
          />
        </TabsContent>
        <TabsContent value="guardrails">
          <GuardrailsTab
            config={simpleConfig}
            onSave={handleSimpleSave}
            saving={saving}
          />
        </TabsContent>
        <TabsContent value="versions">
          <VersionsTab agentId={agentId} />
          <div className="mt-4">
            <AliasManager agentId={agentId} />
          </div>
        </TabsContent>
        <TabsContent value="api-keys">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>API Keys</CardTitle>
                  <CardDescription>Manage API keys for external access to this agent.</CardDescription>
                </div>
                <CreateKeyDialog agentId={agentId} onCreate={createKey} onSuccess={fetchKeys} />
              </div>
            </CardHeader>
            <CardContent>
              <ApiKeyTable keys={keys} loading={keysLoading} onRevoke={revokeKey} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

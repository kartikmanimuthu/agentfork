'use client';

import { useParams, useRouter } from 'next/navigation';
import { useAgent } from '@/hooks/use-agents';
import { useAgentVersions } from '@/hooks/use-agent-versions';
import { useAgentAliases } from '@/hooks/use-agent-aliases';
import { useAgentKnowledgeBases } from '@/hooks/use-agent-knowledge-bases';
import { useAgentMcpServers } from '@/hooks/use-mcp-servers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Bot, ArrowLeft, Play, Pencil, Settings, Key, Clock, Tag, MessageSquare, BookOpen, Server } from 'lucide-react';
import Link from 'next/link';
import type { SimpleAgentConfig } from '@chatbot/agent-studio';

export default function AgentViewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const agentId = params.id;

  const { data: agent, isLoading, error } = useAgent(agentId);
  const { data: versions } = useAgentVersions(agentId);
  const { data: aliases } = useAgentAliases(agentId);
  const { data: knowledgeBases } = useAgentKnowledgeBases(agentId);
  const { data: mcpServers } = useAgentMcpServers(agentId);

  if (isLoading) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 max-w-3xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-64 w-full" />
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

  const simpleConfig = agent.type === 'simple' ? (agent.config as unknown as SimpleAgentConfig) : null;
  const publishedVersion = versions?.find((v) => v.status === 'published');
  const latestVersion = versions?.[0];
  const defaultAlias = aliases?.find((a) => a.isDefault);

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 max-w-3xl mx-auto">
      {/* Header */}
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
        <Bot className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{agent.name}</h1>
          {agent.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{agent.description}</p>
          )}
        </div>
        <Badge variant="outline" className="capitalize">{agent.type}</Badge>
        <Badge variant={agent.status === 'active' ? 'default' : 'secondary'} className="capitalize">{agent.status}</Badge>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button
          nativeButton={false}
          render={<Link href={`/agents/${agentId}/playground`} />}
        >
          <Play className="h-4 w-4 mr-2" />
          Open Playground
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href={`/agents/${agentId}/edit`} />}
        >
          <Pencil className="h-4 w-4 mr-2" />
          Edit Agent
        </Button>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href={`/agents/${agentId}/api-keys`} />}
        >
          <Key className="h-4 w-4 mr-1" />
          API Keys
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 ml-auto"
          nativeButton={false}
          render={<Link href={`/agents/${agentId}/settings`} aria-label="Settings" />}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      <Separator />

      {/* Configuration (read-only) */}
      {simpleConfig && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground text-xs block mb-1">Model</span>
                <span className="font-mono text-sm">{simpleConfig.model || '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block mb-1">Temperature</span>
                <span>{simpleConfig.temperature ?? 0.7}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block mb-1">Max Tokens</span>
                <span>{simpleConfig.maxTokens ?? 'Default'}</span>
              </div>
            </div>
            {simpleConfig.systemPrompt && (
              <div>
                <span className="text-muted-foreground text-xs block mb-1">System Prompt</span>
                <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {simpleConfig.systemPrompt}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {agent.type === 'graph' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Graph Agent</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This agent uses a graph-based workflow. Open the editor to view and modify the graph.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              nativeButton={false}
              render={<Link href={`/agents/${agentId}/edit`} />}
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Open Graph Editor
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Knowledge Bases */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Knowledge Bases
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!knowledgeBases || knowledgeBases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No knowledge bases attached.</p>
          ) : (
            <div className="space-y-2">
              {knowledgeBases.map((kb) => (
                <div key={kb.id} className="flex items-center justify-between p-2.5 rounded-lg border text-sm">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{kb.knowledgeBase.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {kb.knowledgeBase.documentCount} docs · {kb.knowledgeBase.chunkCount} chunks
                    </span>
                    <Badge variant={kb.knowledgeBase.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
                      {kb.knowledgeBase.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* MCP Servers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4" />
            MCP Servers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!mcpServers || mcpServers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No MCP servers attached.</p>
          ) : (
            <div className="space-y-2">
              {mcpServers.map((mcp) => (
                <div key={mcp.id} className="flex items-center justify-between p-2.5 rounded-lg border text-sm">
                  <div className="flex items-center gap-2">
                    <Server className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{mcp.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{mcp.transport}</span>
                    <Badge variant={mcp.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
                      {mcp.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Versions & Aliases */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Versions & Aliases
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground text-xs block mb-1">Total Versions</span>
              <span className="font-semibold">{versions?.length ?? 0}</span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs block mb-1">Published</span>
              <span className="font-semibold">
                {publishedVersion ? `v${publishedVersion.version}` : '—'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs block mb-1">Default Alias</span>
              <span className="font-semibold">
                {defaultAlias ? `${defaultAlias.name} → v${defaultAlias.version.version}` : '—'}
              </span>
            </div>
          </div>

          {aliases && aliases.length > 0 && (
            <div className="pt-2">
              <span className="text-muted-foreground text-xs block mb-2">All Aliases</span>
              <div className="flex flex-wrap gap-2">
                {aliases.map((a) => (
                  <Badge key={a.id} variant={a.isDefault ? 'default' : 'outline'} className="text-xs">
                    <Tag className="h-3 w-3 mr-1" />
                    {a.name} → v{a.version.version}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {latestVersion && (
            <div className="pt-2 text-xs text-muted-foreground">
              Latest: v{latestVersion.version} ({latestVersion.status}) · created{' '}
              {new Date(latestVersion.createdAt).toLocaleDateString()}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick stats */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Quick Links
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/agents/${agentId}/edit`} />}
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit Configuration
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/agents/${agentId}/playground`} />}
            >
              <Play className="h-3.5 w-3.5 mr-1.5" />
              Test in Playground
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/agents/${agentId}/api-keys`} />}
            >
              <Key className="h-3.5 w-3.5 mr-1.5" />
              Manage API Keys
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/agents/${agentId}/settings`} />}
            >
              <Settings className="h-3.5 w-3.5 mr-1.5" />
              Settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

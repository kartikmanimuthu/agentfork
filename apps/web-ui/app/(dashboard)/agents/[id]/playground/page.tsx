'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAgent } from '@/hooks/use-agents';
import { useAgentVersions } from '@/hooks/use-agent-versions';
import { usePlayground } from '@/hooks/use-playground';
import {
  usePlaygroundSessions,
  useCreatePlaygroundSession,
  useUpdatePlaygroundSession,
  useDeletePlaygroundSession,
} from '@/hooks/use-playground-sessions';
import { ChatMessages } from '@/components/chat/chat-messages';
import { ChatInput } from '@/components/chat/chat-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Play,
  Save,
  Trash2,
  Loader2,
  Bot,
  Activity,
  ChevronRight,
  Clock,
  Plus,
  Settings,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PlaygroundVersionSelector } from '@/components/agents/playground/version-selector';

export default function PlaygroundPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const agentId = params.id;

  const { data: agent, isLoading: agentLoading } = useAgent(agentId);
  const { data: versions } = useAgentVersions(agentId);
  const { data: sessions, isLoading: sessionsLoading } = usePlaygroundSessions(agentId);

  const [versionValue, setVersionValue] = useState('current');
  const searchParams = useSearchParams();
  useEffect(() => {
    const v = searchParams.get('version');
    if (v) {
      setVersionValue(v);
    }
  }, [searchParams]);

  const selectedVersionId = versionValue.startsWith('version:')
    ? versionValue.replace('version:', '')
    : undefined;
  const selectedAlias = versionValue.startsWith('alias:')
    ? versionValue.replace('alias:', '')
    : undefined;

  // Load config into override fields when version/agent selection changes
  const lastSelectionRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const currentSelection = selectedVersionId ?? selectedAlias ?? 'agent';
    if (selectedVersionId && !versions) return;
    if (!selectedVersionId && !selectedAlias && !agent) return;
    if (currentSelection === lastSelectionRef.current) return;
    lastSelectionRef.current = currentSelection;

    let config: Record<string, unknown> = {};
    if (selectedVersionId && versions) {
      const version = versions.find((v) => v.id === selectedVersionId);
      if (version) {
        config = (version.config as Record<string, unknown>) ?? {};
      }
    } else if (!selectedAlias && agent) {
      config = (agent.config as Record<string, unknown>) ?? {};
    }

    // For graph agents, extract config from the first LLM node in the graph
    if (agent?.type === 'graph' && config.nodes) {
      const nodes = config.nodes as Array<{ config?: { type?: string; model?: string; modelId?: string; systemPrompt?: string; temperature?: number; maxTokens?: number } }>;
      const llmNode = nodes.find((n) => n.config?.type === 'llm');
      if (llmNode?.config) {
        setSystemPrompt(String(llmNode.config.systemPrompt ?? ''));
        setTemperature(Number(llmNode.config.temperature ?? 0.7));
        setModel(String(llmNode.config.modelId ?? llmNode.config.model ?? ''));
        setMaxTokens(llmNode.config.maxTokens ? Number(llmNode.config.maxTokens) : undefined);
        return;
      }
    }

    setSystemPrompt(String(config.systemPrompt ?? ''));
    setTemperature(Number(config.temperature ?? 0.7));
    setModel(String(config.model ?? ''));
    setMaxTokens(config.maxTokens ? Number(config.maxTokens) : undefined);
  }, [selectedVersionId, selectedAlias, versions, agent]);

  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [model, setModel] = useState('');
  const [maxTokens, setMaxTokens] = useState<number | undefined>(undefined);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [sessionName, setSessionName] = useState('New Session');
  const [showTrace, setShowTrace] = useState(true);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<string | null>(null);

  const createSession = useCreatePlaygroundSession(agentId);
  const updateSession = useUpdatePlaygroundSession(agentId);
  const deleteSession = useDeletePlaygroundSession(agentId);

  const {
    messages,
    isLoading,
    overrides,
    setOverrides,
    executions,
    refreshExecutions,
    handleSend,
    handleRegenerate,
    setMessages,
  } = usePlayground({
    agentId,
    agentType: agent?.type ?? 'simple',
    versionId: selectedVersionId,
    alias: selectedAlias,
    onError: (err) => toast.error(err.message),
  });

  const handleVersionChange = (val: string) => {
    if (val !== versionValue) {
      setVersionValue(val);
      setMessages([]);
    }
  };

  const handleApplyOverrides = () => {
    setOverrides({
      systemPrompt: systemPrompt || undefined,
      temperature: temperature,
      model: model || undefined,
      maxTokens: maxTokens,
    });
    toast.success('Overrides applied');
  };

  const handleSaveSession = async () => {
    const payload = {
      name: sessionName,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join(''),
      })),
      configOverrides: overrides as Record<string, unknown>,
      agentVersionId: selectedVersionId ?? null,
      model: model || undefined,
      maxTokens: maxTokens,
    };

    if (activeSessionId) {
      await updateSession.mutateAsync({ sessionId: activeSessionId, input: payload });
      toast.success('Session saved');
    } else {
      const session = await createSession.mutateAsync(payload);
      setActiveSessionId(session.id);
      toast.success('Session created');
    }
  };

  const handleLoadSession = (session: any) => {
    setActiveSessionId(session.id);
    setSessionName(session.name);
    setVersionValue(session.agentVersionId ? `version:${session.agentVersionId}` : 'current');
    setOverrides((session.configOverrides as Record<string, unknown>) ?? {});
    if (session.configOverrides) {
      const co = session.configOverrides as Record<string, unknown>;
      if (co.systemPrompt) setSystemPrompt(String(co.systemPrompt));
      if (co.temperature) setTemperature(Number(co.temperature));
      if (co.model) setModel(String(co.model));
      if (co.maxTokens) setMaxTokens(Number(co.maxTokens));
    }
    setMessages(
      (session.messages as Array<{ id: string; role: string; content: string }>).map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        parts: [{ type: 'text' as const, text: m.content }],
      }))
    );
  };

  const handleNewSession = () => {
    setActiveSessionId(undefined);
    setSessionName('New Session');
    setMessages([]);
    setOverrides({});
    setSystemPrompt('');
    setTemperature(0.7);
    setModel('');
    setMaxTokens(undefined);
    setVersionValue('current');
    // Clear query params so version doesn't re-apply from URL
    if (searchParams.toString()) {
      router.replace(`/agents/${agentId}/playground`, { scroll: false });
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    await deleteSession.mutateAsync(sessionId);
    setDeleteSessionTarget(null);
    if (activeSessionId === sessionId) {
      handleNewSession();
    }
  };

  if (agentLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Agent not found.</p>
      </div>
    );
  }

  const currentVersion = versions?.find((v) => v.id === selectedVersionId);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-background shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          nativeButton={false}
          render={<Link href={`/agents/${agentId}`} aria-label="Back to agent" />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium truncate">{agent.name}</span>
        <Badge variant="outline" className="capitalize text-[10px]">
          {agent.type}
        </Badge>
        {currentVersion && (
          <Badge variant="secondary" className="text-[10px]">
            v{currentVersion.version}
          </Badge>
        )}
        {selectedAlias && (
          <Badge variant="secondary" className="text-[10px]">
            {selectedAlias}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleNewSession}>
            <Plus className="h-4 w-4 mr-1" />
            New
          </Button>
          <Button variant="ghost" size="sm" onClick={handleSaveSession} disabled={createSession.isPending || updateSession.isPending}>
            <Save className="h-4 w-4 mr-1" />
            Save
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sessions Sidebar */}
        <div className="w-64 border-r bg-muted/30 flex flex-col shrink-0">
          <div className="px-3 py-2 border-b">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Sessions</h3>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {sessionsLoading && (
                <div className="text-xs text-muted-foreground px-2 py-4 text-center">Loading...</div>
              )}
              {sessions?.length === 0 && !sessionsLoading && (
                <div className="text-xs text-muted-foreground px-2 py-4 text-center">No saved sessions</div>
              )}
              {sessions?.map((session) => (
                <button
                  key={session.id}
                  onClick={() => handleLoadSession(session)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-md text-xs transition-colors group flex items-center justify-between',
                    activeSessionId === session.id
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-accent text-muted-foreground'
                  )}
                >
                  <div className="flex flex-col truncate">
                    <span className="font-medium truncate">{session.name}</span>
                    <span className="text-[10px] opacity-70">
                      {new Date(session.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSession(session.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-2 border-b bg-background shrink-0 flex items-center gap-2">
            <Input
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              className="h-7 text-sm font-medium border-0 bg-transparent focus-visible:ring-0 px-0 w-auto min-w-[200px]"
              placeholder="Session name..."
            />
            {activeSessionId && (
              <Badge variant="outline" className="text-[10px]">Saved</Badge>
            )}
          </div>
          <ChatMessages
            messages={messages}
            isLoading={isLoading}
            onRegenerate={handleRegenerate}
          />
          <ChatInput onSend={handleSend} isLoading={isLoading} />
        </div>

        {/* Config / Trace Sidebar */}
        <div className="w-80 border-l bg-muted/30 flex flex-col shrink-0">
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-6">
              {/* Version Selector */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Version</label>
                <PlaygroundVersionSelector
                  agentId={agentId}
                  value={versionValue}
                  onChange={handleVersionChange}
                />
              </div>

              <Separator />

              {/* Overrides */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Overrides</label>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Model</label>
                  <Input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Override model..."
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">System Prompt</label>
                  <Textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Override system prompt..."
                    rows={4}
                    className="text-xs resize-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Temperature: {temperature}</label>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.1}
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Max Tokens: {maxTokens ?? 'default'}</label>
                  <Input
                    type="number"
                    value={maxTokens ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setMaxTokens(val ? parseInt(val, 10) : undefined);
                    }}
                    placeholder="Leave blank for default"
                    className="h-8 text-xs"
                  />
                </div>
                <Button size="sm" className="w-full" onClick={handleApplyOverrides}>
                  <Play className="h-3.5 w-3.5 mr-1" />
                  Apply Overrides
                </Button>
              </div>

              <Separator />

              {/* Trace Panel */}
              <div className="space-y-2">
                <button
                  className="flex items-center gap-2 w-full"
                  onClick={() => setShowTrace(!showTrace)}
                >
                  <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold uppercase text-muted-foreground">Execution Trace</span>
                  <ChevronRight className={cn('h-3 w-3 ml-auto transition-transform', showTrace && 'rotate-90')} />
                </button>
                {showTrace && (
                  <div className="space-y-2 pt-1">
                    {executions.length === 0 && (
                      <p className="text-xs text-muted-foreground">Run the agent to see execution traces.</p>
                    )}
                    {executions.map((exec) => (
                      <Card key={exec.id} className="border-dashed">
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <Badge
                              variant={
                                exec.status === 'completed'
                                  ? 'default'
                                  : exec.status === 'failed'
                                    ? 'destructive'
                                    : 'secondary'
                              }
                              className="text-[10px]"
                            >
                              {exec.status}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(exec.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                          {exec.trace && (
                            <pre className="text-[10px] bg-muted rounded p-2 overflow-auto max-h-32">
                              {JSON.stringify(exec.trace, null, 2)}
                            </pre>
                          )}
                          {exec.output && (
                            <pre className="text-[10px] bg-muted rounded p-2 overflow-auto max-h-32">
                              {JSON.stringify(exec.output, null, 2)}
                            </pre>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>
    <AlertDialog open={!!deleteSessionTarget} onOpenChange={(open) => !open && setDeleteSessionTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete session?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setDeleteSessionTarget(null)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => deleteSessionTarget && handleDeleteSession(deleteSessionTarget)}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </div>
  );
}

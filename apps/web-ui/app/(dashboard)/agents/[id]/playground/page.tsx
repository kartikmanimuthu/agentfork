'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAgent } from '@/hooks/use-agents';
import { useAgentVersions } from '@/hooks/use-agent-versions';
import { usePlayground } from '@/hooks/use-playground';
import { useConsole } from '@/hooks/use-console';
import {
  usePlaygroundSessions,
  useCreatePlaygroundSession,
  useUpdatePlaygroundSession,
  useDeletePlaygroundSession,
} from '@/hooks/use-playground-sessions';
import { ChatMessages } from '@/components/chat/chat-messages';
import { ChatInput, type UploadedAttachment } from '@/components/chat/chat-input';
import { PlaygroundConsole } from '@/components/agents/playground/console';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Save,
  Trash2,
  Loader2,
  Bot,
  Plus,
  PanelRightClose,
  PanelRightOpen,
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
      const nodes = config.nodes as Array<{
        config?: {
          type?: string;
          model?: string;
          modelId?: string;
          systemPrompt?: string;
          temperature?: number;
          maxTokens?: number;
        };
      }>;
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
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<string | null>(null);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

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
    consoleEvents,
    messageMetrics,
    rawDataMap,
    thinkingMap,
  } = usePlayground({
    agentId,
    agentType: agent?.type ?? 'simple',
    versionId: selectedVersionId,
    alias: selectedAlias,
    onError: (err) => toast.error(err.message),
  });

  const uploadFile = useCallback(
    async (file: File): Promise<UploadedAttachment> => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/agents/${agentId}/playground/files`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message ?? 'Upload failed');
      }
      return res.json();
    },
    [agentId],
  );

  const {
    activeTab,
    setActiveTab,
    selectedMessageId,
    selectMessage,
    clearSelection,
    severityFilter,
    setSeverityFilter,
    eventTypeFilter,
    setEventTypeFilter,
    isAutoScrolling,
    setIsAutoScrolling,
    filteredEvents,
    selectedMetrics,
    sessionMetrics,
    selectedRawData,
    eventTypes,
  } = useConsole({ consoleEvents, messageMetrics, rawDataMap });

  const handleVersionChange = (val: string) => {
    if (val !== versionValue) {
      setVersionValue(val);
      setMessages([]);
      setOverrides({});
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
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSaveSession}
            disabled={createSession.isPending || updateSession.isPending}
          >
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
                <div className="text-xs text-muted-foreground px-2 py-4 text-center">
                  Loading...
                </div>
              )}
              {sessions?.length === 0 && !sessionsLoading && (
                <div className="text-xs text-muted-foreground px-2 py-4 text-center">
                  No saved sessions
                </div>
              )}
              {sessions?.map((session) => (
                <div
                  key={session.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleLoadSession(session)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLoadSession(session); }}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-md text-xs transition-colors group flex items-center justify-between cursor-pointer',
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
                      setDeleteSessionTarget(session.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="px-4 py-2 border-b bg-background shrink-0 flex items-center gap-2">
            <Input
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              className="h-7 text-sm font-medium border-0 bg-transparent focus-visible:ring-0 px-0 w-auto min-w-[200px]"
              placeholder="Session name..."
            />
            {activeSessionId && (
              <Badge variant="outline" className="text-[10px]">
                Saved
              </Badge>
            )}
            <div className="ml-auto">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
                title={rightPanelCollapsed ? 'Show console' : 'Hide console'}
              >
                {rightPanelCollapsed ? (
                  <PanelRightOpen className="h-4 w-4" />
                ) : (
                  <PanelRightClose className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <ChatMessages
            messages={messages}
            isLoading={isLoading}
            onRegenerate={handleRegenerate}
            selectedMessageId={selectedMessageId}
            onSelectMessage={selectMessage}
            messageMetrics={messageMetrics}
            thinkingMap={thinkingMap}
            showMetadata
          />
          <ChatInput onSend={handleSend} isLoading={isLoading} uploadFile={uploadFile} />
        </div>

        {/* Right Panel: Console with Config tab */}
        {!rightPanelCollapsed && (
          <div className="w-[380px] border-l flex flex-col shrink-0">
            <PlaygroundConsole
              activeTab={activeTab}
              onTabChange={setActiveTab}
              events={filteredEvents}
              isAutoScrolling={isAutoScrolling}
              onAutoScrollChange={setIsAutoScrolling}
              severityFilter={severityFilter}
              onSeverityFilterChange={setSeverityFilter}
              eventTypes={eventTypes}
              eventTypeFilter={eventTypeFilter}
              onEventTypeFilterChange={setEventTypeFilter}
              rawData={selectedRawData}
              selectedMetrics={selectedMetrics}
              sessionMetrics={sessionMetrics}
              selectedMessageId={selectedMessageId}
              onClearSelection={clearSelection}
              config={{
                agentId,
                versionValue,
                onVersionChange: handleVersionChange,
                model,
                onModelChange: setModel,
                systemPrompt,
                onSystemPromptChange: setSystemPrompt,
                temperature,
                onTemperatureChange: setTemperature,
                maxTokens,
                onMaxTokensChange: setMaxTokens,
                onApplyOverrides: handleApplyOverrides,
              }}
            />
          </div>
        )}
      </div>

      <AlertDialog
        open={!!deleteSessionTarget}
        onOpenChange={(open) => !open && setDeleteSessionTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
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

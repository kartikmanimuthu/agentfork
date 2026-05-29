'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAgents } from '@/hooks/use-agents';
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Save,
  Trash2,
  Bot,
  Plus,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
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

interface AgentItem {
  id: string;
  name: string;
  type: 'simple' | 'graph';
  config?: Record<string, unknown>;
}

function PlaygroundWorkspace({ agent }: { agent: AgentItem }) {
  const agentId = agent.id;
  const { data: versions } = useAgentVersions(agentId);

  const [versionValue, setVersionValue] = useState('current');
  const selectedVersionId = versionValue.startsWith('version:')
    ? versionValue.replace('version:', '')
    : undefined;
  const selectedAlias = versionValue.startsWith('alias:')
    ? versionValue.replace('alias:', '')
    : undefined;

  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [model, setModel] = useState('');
  const [maxTokens, setMaxTokens] = useState<number | undefined>(undefined);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [sessionName, setSessionName] = useState('New Session');
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<string | null>(null);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  const { data: sessions, isLoading: sessionsLoading } = usePlaygroundSessions(agentId);
  const createSession = useCreatePlaygroundSession(agentId);
  const updateSession = useUpdatePlaygroundSession(agentId);
  const deleteSession = useDeletePlaygroundSession(agentId);

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

    if (agent.type === 'graph' && config.nodes) {
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

  const {
    messages,
    isLoading,
    overrides,
    setOverrides,
    handleSend,
    handleRegenerate,
    setMessages,
    consoleEvents,
    messageMetrics,
    rawDataMap,
    thinkingMap,
  } = usePlayground({
    agentId,
    agentType: agent.type,
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
  };

  const handleDeleteSession = async (sessionId: string) => {
    await deleteSession.mutateAsync(sessionId);
    setDeleteSessionTarget(null);
    if (activeSessionId === sessionId) {
      handleNewSession();
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Sub-header with session name + actions */}
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

      {/* Three-panel layout */}
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

        {/* Right Panel: Console */}
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
            <AlertDialogCancel onClick={() => setDeleteSessionTarget(null)}>
              Cancel
            </AlertDialogCancel>
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

export default function GenericPlaygroundPage() {
  const { data: agentsData, isLoading: agentsLoading } = useAgents({ pageSize: 100 });
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);

  const agent = agentsData?.items.find((a) => a.id === selectedAgentId);

  if (agentsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with agent selector */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-background shrink-0">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Playground</span>
        <div className="flex items-center gap-2 ml-4">
          <Select value={selectedAgentId ?? ''} onValueChange={setSelectedAgentId}>
            <SelectTrigger className="h-8 text-xs w-56">
              <SelectValue placeholder="Select an agent..." />
            </SelectTrigger>
            <SelectContent>
              {agentsData?.items.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {agent && (
            <Badge variant="outline" className="capitalize text-[10px]">
              {agent.type}
            </Badge>
          )}
        </div>
      </div>

      {/* Main Content */}
      {!selectedAgentId || !agent ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="border border-dashed rounded-lg p-8 text-center space-y-4 w-96">
            <Bot className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground">
              Select an agent from the dropdown above to start testing.
            </p>
          </div>
        </div>
      ) : (
        <PlaygroundWorkspace key={selectedAgentId} agent={agent as AgentItem} />
      )}
    </div>
  );
}

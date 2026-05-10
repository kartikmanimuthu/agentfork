'use client';

import { useState, useEffect, useRef } from 'react';
import { useAgents } from '@/hooks/use-agents';
import { useAgentVersions } from '@/hooks/use-agent-versions';
import { useAgentAliases } from '@/hooks/use-agent-aliases';
import { usePlayground } from '@/hooks/use-playground';
import { ChatMessages } from '@/components/chat/chat-messages';
import { ChatInput } from '@/components/chat/chat-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Bot } from 'lucide-react';

function PlaygroundChat({
  agentId,
  agentType,
  versionId,
  alias,
}: {
  agentId: string;
  agentType: 'simple' | 'graph';
  versionId?: string;
  alias?: string;
}) {
  const {
    messages,
    isLoading,
    handleSend,
    handleRegenerate,
    setMessages,
  } = usePlayground({
    agentId,
    agentType,
    versionId,
    alias,
    onError: (err) => toast.error(err.message),
  });

  const prevVersionId = useRef(versionId);
  const prevAlias = useRef(alias);
  useEffect(() => {
    if (prevVersionId.current !== versionId || prevAlias.current !== alias) {
      setMessages([]);
      prevVersionId.current = versionId;
      prevAlias.current = alias;
    }
  }, [versionId, alias, setMessages]);

  return (
    <>
      <ChatMessages messages={messages} isLoading={isLoading} onRegenerate={handleRegenerate} />
      <ChatInput onSend={handleSend} isLoading={isLoading} />
    </>
  );
}

export default function GenericPlaygroundPage() {
  const { data: agentsData, isLoading: agentsLoading } = useAgents({ pageSize: 100 });
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>(undefined);
  const [selectedAlias, setSelectedAlias] = useState<string | undefined>(undefined);

  const agent = agentsData?.items.find((a) => a.id === selectedAgentId);
  const { data: versions } = useAgentVersions(selectedAgentId ?? '');
  const { data: aliases } = useAgentAliases(selectedAgentId ?? '');

  const handleAgentChange = (agentId: string) => {
    setSelectedAgentId(agentId);
    setSelectedVersionId(undefined);
    setSelectedAlias(undefined);
  };

  const handleVersionChange = (value: string) => {
    if (value === 'current') {
      setSelectedVersionId(undefined);
      setSelectedAlias(undefined);
    } else if (value.startsWith('alias:')) {
      setSelectedVersionId(undefined);
      setSelectedAlias(value.replace('alias:', ''));
    } else {
      setSelectedVersionId(value);
      setSelectedAlias(undefined);
    }
  };

  if (agentsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-background shrink-0">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Playground</span>
        <div className="flex items-center gap-2 ml-4">
          <Select value={selectedAgentId ?? ''} onValueChange={handleAgentChange}>
            <SelectTrigger className="h-8 text-xs w-56">
              <SelectValue placeholder="Select an agent..." />
            </SelectTrigger>
            <SelectContent>
              {agentsData?.items.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {agent && (
            <>
              <Badge variant="outline" className="capitalize text-[10px]">{agent.type}</Badge>
              <Select value={selectedVersionId ?? 'current'} onValueChange={handleVersionChange}>
                <SelectTrigger className="h-8 text-xs w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">Current (Draft)</SelectItem>
                  {aliases?.map((a) => (
                    <SelectItem key={`alias:${a.name}`} value={`alias:${a.name}`}>
                      {a.name}{a.isDefault ? ' (default)' : ''} → v{a.version.version}
                    </SelectItem>
                  ))}
                  {versions?.map((v) => (
                    <SelectItem key={v.id} value={v.id}>v{v.version} ({v.status})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!selectedAgentId ? (
          <div className="flex-1 flex items-center justify-center">
            <Card className="w-96">
              <CardContent className="p-6 text-center space-y-4">
                <Bot className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-muted-foreground">Select an agent from the dropdown above to start testing.</p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <PlaygroundChat
            key={selectedAgentId}
            agentId={selectedAgentId}
            agentType={agent?.type ?? 'simple'}
            versionId={selectedVersionId}
            alias={selectedAlias}
          />
        )}
      </div>
    </div>
  );
}

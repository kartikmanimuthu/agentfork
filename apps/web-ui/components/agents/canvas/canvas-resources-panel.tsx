'use client';

import { KnowledgeBasesTab } from '../tabs/knowledge-bases-tab';
import { McpServersTab } from '../tabs/mcp-servers-tab';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';

interface CanvasResourcesPanelProps {
  agentId: string;
  agentConfig: Record<string, unknown>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CanvasResourcesPanel({
  agentId,
  agentConfig,
  open,
  onOpenChange,
}: CanvasResourcesPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Resources</SheetTitle>
          <SheetDescription>Manage knowledge bases and MCP servers attached to this agent.</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="knowledge-bases" className="flex-1 flex flex-col overflow-hidden px-4">
          <TabsList className="w-full">
            <TabsTrigger value="knowledge-bases" className="flex-1">Knowledge Bases</TabsTrigger>
            <TabsTrigger value="mcp-servers" className="flex-1">MCP Servers</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-4">
            <TabsContent value="knowledge-bases" className="mt-0">
              <KnowledgeBasesTab agentId={agentId} agentConfig={agentConfig} />
            </TabsContent>
            <TabsContent value="mcp-servers" className="mt-0">
              <McpServersTab agentId={agentId} agentConfig={agentConfig} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

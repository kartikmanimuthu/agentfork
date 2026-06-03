'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { X, Trash2 } from 'lucide-react';
import { LlmNodeForm } from './llm-node-form';
import { ToolNodeForm } from './tool-node-form';
import { RouterNodeForm } from './router-node-form';
import { StateSchemaNodeForm } from './state-schema-node-form';
import { InputNodeForm } from './input-node-form';
import { OutputNodeForm } from './output-node-form';
import { MemoryNodeForm } from './memory-node-form';
import { KnowledgeBaseNodeForm } from './knowledge-base-node-form';
import { McpServerNodeForm } from './mcp-server-node-form';
import { CodeNodeForm } from './code-node-form';
import { ConditionNodeForm } from './condition-node-form';
import { HttpNodeForm } from './http-node-form';
import { HumanNodeForm } from './human-node-form';
import { ParallelNodeForm } from './parallel-node-form';
import { SubAgentNodeForm } from './sub-agent-node-form';
import { DelayNodeForm } from './delay-node-form';
import { WhatsAppTriggerNodeForm } from './whatsapp-trigger-node-form';
import { WhatsAppSendNodeForm } from './whatsapp-send-node-form';
import { WhatsAppSendTemplateNodeForm } from './whatsapp-send-template-node-form';
import type { GraphNode } from '@chatbot/agent-studio';
import type { NodeConfig } from '@chatbot/agent-studio';
import type { NodeOption } from './node-picker';

interface ConfigPanelProps {
  node: GraphNode | null;
  allNodes: NodeOption[];
  onClose: () => void;
  onConfigChange: (nodeId: string, config: NodeConfig) => void;
  onDelete?: (nodeId: string) => void;
}

export function ConfigPanel({ node, allNodes, onClose, onConfigChange, onDelete }: ConfigPanelProps) {
  if (!node) return null;

  const handleChange = (config: NodeConfig) => onConfigChange(node.id, config);

  return (
    <aside className="w-72 border-l bg-background flex flex-col shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{node.label}</p>
          <p className="text-xs text-muted-foreground capitalize">{node.config.type} node</p>
          <p className="text-[10px] text-muted-foreground/60 font-mono truncate">{node.id}</p>
        </div>
        <div className="flex items-center gap-1">
          {onDelete && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(node.id)} aria-label="Delete node">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close config panel">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {node.config.type === 'llm' && (
            <LlmNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'tool' && (
            <ToolNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'router' && (
            <RouterNodeForm config={node.config} onChange={handleChange} allNodes={allNodes} />
          )}
          {node.config.type === 'state_schema' && (
            <StateSchemaNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'input' && (
            <InputNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'output' && (
            <OutputNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'memory' && (
            <MemoryNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'knowledge_base' && (
            <KnowledgeBaseNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'mcp_server' && (
            <McpServerNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'code' && (
            <CodeNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'condition' && (
            <ConditionNodeForm config={node.config} onChange={handleChange} allNodes={allNodes} />
          )}
          {node.config.type === 'http' && (
            <HttpNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'human' && (
            <HumanNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'parallel' && (
            <ParallelNodeForm config={node.config} onChange={handleChange} allNodes={allNodes} />
          )}
          {node.config.type === 'sub_agent' && (
            <SubAgentNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'delay' && (
            <DelayNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'whatsapp_trigger' && (
            <WhatsAppTriggerNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'whatsapp_send' && (
            <WhatsAppSendNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'whatsapp_send_template' && (
            <WhatsAppSendTemplateNodeForm config={node.config} onChange={handleChange} />
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

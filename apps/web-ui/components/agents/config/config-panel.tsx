'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { LlmNodeForm } from './llm-node-form';
import { ToolNodeForm } from './tool-node-form';
import { RouterNodeForm } from './router-node-form';
import { StateSchemaNodeForm } from './state-schema-node-form';
import type { GraphNode } from '@chatbot/agent-studio';
import type { NodeConfig } from '@chatbot/agent-studio';

interface ConfigPanelProps {
  node: GraphNode | null;
  onClose: () => void;
  onConfigChange: (nodeId: string, config: NodeConfig) => void;
}

export function ConfigPanel({ node, onClose, onConfigChange }: ConfigPanelProps) {
  if (!node) return null;

  const handleChange = (config: NodeConfig) => onConfigChange(node.id, config);

  return (
    <aside className="w-72 border-l bg-background flex flex-col shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <p className="text-sm font-semibold truncate">{node.label}</p>
          <p className="text-xs text-muted-foreground capitalize">{node.config.type} node</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close config panel">
          <X className="h-4 w-4" />
        </Button>
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
            <RouterNodeForm config={node.config} onChange={handleChange} />
          )}
          {node.config.type === 'state_schema' && (
            <StateSchemaNodeForm config={node.config} onChange={handleChange} />
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

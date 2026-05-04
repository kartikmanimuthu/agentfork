'use client';

import { useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { NodeRegistry, GraphValidationService } from '@chatbot/agent-studio';
import type { GraphNode, GraphEdge, NodeConfig, ValidationError } from '@chatbot/agent-studio';
import { nodeTypes } from './node-types';
import { NodePalette } from './node-palette';
import { CanvasToolbar } from './canvas-toolbar';
import { CanvasStatusBar } from './canvas-status-bar';
import { ConfigPanel } from '../config/config-panel';
import { useAgentCanvasStore } from '@/store/agent-canvas-store';
import { toast } from 'sonner';
import { useState } from 'react';

// Convert GraphNode → React Flow Node
function toRfNode(n: GraphNode): Node {
  return {
    id: n.id,
    type: n.config.type,
    position: n.position,
    data: { label: n.label, config: n.config },
  };
}

// Convert GraphEdge → React Flow Edge
function toRfEdge(e: GraphEdge): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    label: e.label,
  };
}

interface AgentCanvasProps {
  agentId: string;
  agentName: string;
  initialNodes: GraphNode[];
  initialEdges: GraphEdge[];
  onSave: (nodes: GraphNode[], edges: GraphEdge[]) => Promise<void>;
  onPublish: () => Promise<void>;
}

export function AgentCanvas({
  agentId,
  agentName,
  initialNodes,
  initialEdges,
  onSave,
  onPublish,
}: AgentCanvasProps) {
  const store = useAgentCanvasStore();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(initialNodes.map(toRfNode));
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(initialEdges.map(toRfEdge));

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Sync store on mount
  useEffect(() => {
    store.setAgent(agentId, null);
    store.setGraph(initialNodes, initialEdges);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setRfEdges((eds) => addEdge(connection, eds));
      setIsDirty(true);
    },
    [setRfEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData('application/reactflow/type');
      if (!nodeType || !NodeRegistry.has(nodeType)) return;

      const wrapper = reactFlowWrapper.current;
      if (!wrapper) return;

      const bounds = wrapper.getBoundingClientRect();
      const position = {
        x: event.clientX - bounds.left - 90,
        y: event.clientY - bounds.top - 30,
      };

      const def = NodeRegistry.get(nodeType as Parameters<typeof NodeRegistry.get>[0]);
      const id = `${nodeType}-${Date.now()}`;
      const newNode: Node = {
        id,
        type: nodeType,
        position,
        data: { label: def.label, config: def.defaultConfig },
      };

      setRfNodes((nds) => [...nds, newNode]);
      setIsDirty(true);
    },
    [setRfNodes]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const selectedNode: GraphNode | null = selectedNodeId
    ? (() => {
        const rfNode = rfNodes.find((n) => n.id === selectedNodeId);
        if (!rfNode) return null;
        return {
          id: rfNode.id,
          type: rfNode.type ?? 'llm',
          label: (rfNode.data as { label: string }).label,
          config: (rfNode.data as { config: NodeConfig }).config,
          position: rfNode.position,
        };
      })()
    : null;

  const handleConfigChange = useCallback(
    (nodeId: string, config: NodeConfig) => {
      setRfNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, type: config.type, data: { ...n.data, config } }
            : n
        )
      );
      setIsDirty(true);
    },
    [setRfNodes]
  );

  const buildGraph = useCallback(() => {
    const nodes: GraphNode[] = rfNodes.map((n) => ({
      id: n.id,
      type: n.type ?? 'llm',
      label: (n.data as { label: string }).label,
      config: (n.data as { config: NodeConfig }).config,
      position: n.position,
    }));
    const edges: GraphEdge[] = rfEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      label: typeof e.label === 'string' ? e.label : undefined,
    }));
    return { nodes, edges };
  }, [rfNodes, rfEdges]);

  const handleValidate = useCallback(async () => {
    setIsValidating(true);
    try {
      const { nodes, edges } = buildGraph();
      const result = GraphValidationService.validate({ nodes, edges });
      setValidationErrors(result.errors);
      if (result.valid) {
        toast.success('Graph is valid');
      } else {
        toast.error(`${result.errors.length} validation error${result.errors.length !== 1 ? 's' : ''}`);
      }
    } finally {
      setIsValidating(false);
    }
  }, [buildGraph]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const { nodes, edges } = buildGraph();
      await onSave(nodes, edges);
      setIsDirty(false);
      store.markClean();
      toast.success('Saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setIsSaving(false);
    }
  }, [buildGraph, onSave, store]);

  const handlePublish = useCallback(async () => {
    setIsPublishing(true);
    try {
      await onPublish();
      toast.success('Agent published');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setIsPublishing(false);
    }
  }, [onPublish]);

  return (
    <div className="flex flex-col h-full">
      <CanvasToolbar
        agentName={agentName}
        isDirty={isDirty}
        isSaving={isSaving}
        isValidating={isValidating}
        isPublishing={isPublishing}
        onSave={handleSave}
        onValidate={handleValidate}
        onPublish={handlePublish}
      />

      <div className="flex flex-1 overflow-hidden">
        <NodePalette />

        <div
          ref={reactFlowWrapper}
          className="flex-1 relative"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode="Delete"
            className="bg-muted/20"
          >
            <Background />
            <Controls />
            <MiniMap nodeStrokeWidth={3} zoomable pannable />
          </ReactFlow>
        </div>

        <ConfigPanel
          node={selectedNode}
          onClose={() => setSelectedNodeId(null)}
          onConfigChange={handleConfigChange}
        />
      </div>

      <CanvasStatusBar
        nodeCount={rfNodes.length}
        edgeCount={rfEdges.length}
        validationErrors={validationErrors}
      />
    </div>
  );
}

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
import { NodeContextMenu } from './node-context-menu';
import { EdgeContextMenu } from './edge-context-menu';
import { CanvasToolbar } from './canvas-toolbar';
import { CanvasStatusBar } from './canvas-status-bar';
import { VersionsPanel } from './versions-panel';
import { CanvasResourcesPanel } from './canvas-resources-panel';
import { ConfigPanel } from '../config/config-panel';
import { useAgentCanvasStore } from '@/store/agent-canvas-store';
import { useCanvasKeyboardShortcuts } from '@/hooks/use-canvas-keyboard-shortcuts';
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
  agentConfig: Record<string, unknown>;
  initialNodes: GraphNode[];
  initialEdges: GraphEdge[];
  onSave: (nodes: GraphNode[], edges: GraphEdge[]) => Promise<void>;
  onPublish: () => Promise<void>;
}

export function AgentCanvas({
  agentId,
  agentName,
  agentConfig,
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
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [edgeContextMenu, setEdgeContextMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);

  // Sync store on mount
  useEffect(() => {
    store.setAgent(agentId, null);
    store.setGraph(initialNodes, initialEdges);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

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
    setContextMenu(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setContextMenu(null);
    setEdgeContextMenu(null);
  }, []);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
    setEdgeContextMenu(null);
  }, []);

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    setEdgeContextMenu({ edgeId: edge.id, x: event.clientX, y: event.clientY });
    setContextMenu(null);
  }, []);

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      setRfEdges((eds) => eds.filter((e) => e.id !== edgeId));
      setIsDirty(true);
    },
    [setRfEdges]
  );

  const handleAddEdgeLabel = useCallback(
    (edgeId: string) => {
      const label = prompt('Edge label:');
      if (label === null) return;
      setRfEdges((eds) =>
        eds.map((e) => (e.id === edgeId ? { ...e, label: label || undefined } : e))
      );
      setIsDirty(true);
    },
    [setRfEdges]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setRfNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setRfEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      setIsDirty(true);
    },
    [setRfNodes, setRfEdges, selectedNodeId]
  );

  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      const source = rfNodes.find((n) => n.id === nodeId);
      if (!source) return;
      const id = `${source.type}-${Date.now()}`;
      const newNode: Node = {
        ...source,
        id,
        position: { x: source.position.x + 50, y: source.position.y + 50 },
        selected: false,
      };
      setRfNodes((nds) => [...nds, newNode]);
      setIsDirty(true);
    },
    [rfNodes, setRfNodes]
  );

  const getSelectedNodeIds = useCallback(() => {
    return selectedNodeId ? [selectedNodeId] : [];
  }, [selectedNodeId]);

  const handleCopyNodes = useCallback(
    (ids: string[]) => {
      const nodes = rfNodes
        .filter((n) => ids.includes(n.id))
        .map((n) => ({
          id: n.id,
          type: n.type ?? 'llm',
          label: (n.data as { label: string }).label,
          config: (n.data as { config: NodeConfig }).config,
          position: n.position,
        }));
      store.setClipboard(nodes);
    },
    [rfNodes, store]
  );

  const handlePasteNodes = useCallback(() => {
    const clipboard = store.clipboard;
    if (clipboard.length === 0) return;
    const newNodes: Node[] = clipboard.map((n) => ({
      id: `${n.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: n.config.type,
      position: { x: n.position.x + 50, y: n.position.y + 50 },
      data: { label: n.label, config: n.config },
      selected: false,
    }));
    setRfNodes((nds) => [...nds, ...newNodes]);
    setIsDirty(true);
  }, [store, setRfNodes]);

  useCanvasKeyboardShortcuts({
    containerRef: reactFlowWrapper,
    getSelectedNodeIds,
    onDelete: (ids) => ids.forEach(handleDeleteNode),
    onDuplicate: (ids) => ids.forEach(handleDuplicateNode),
    onCopy: handleCopyNodes,
    onPaste: handlePasteNodes,
  });

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
        onOpenVersions={() => setVersionsOpen(true)}
        onOpenResources={() => setResourcesOpen(true)}
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
            onNodeContextMenu={onNodeContextMenu}
            onEdgeContextMenu={onEdgeContextMenu}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode={null}
            className="bg-muted/20"
          >
            <Background />
            <Controls />
            <MiniMap nodeStrokeWidth={3} zoomable pannable />
          </ReactFlow>
          {contextMenu && (
            <NodeContextMenu
              nodeId={contextMenu.nodeId}
              position={{ x: contextMenu.x, y: contextMenu.y }}
              onEdit={(id) => setSelectedNodeId(id)}
              onDuplicate={handleDuplicateNode}
              onDelete={handleDeleteNode}
              onClose={() => setContextMenu(null)}
            />
          )}
          {edgeContextMenu && (
            <EdgeContextMenu
              edgeId={edgeContextMenu.edgeId}
              position={{ x: edgeContextMenu.x, y: edgeContextMenu.y }}
              onAddLabel={handleAddEdgeLabel}
              onDelete={handleDeleteEdge}
              onClose={() => setEdgeContextMenu(null)}
            />
          )}
        </div>

        <ConfigPanel
          node={selectedNode}
          onClose={() => setSelectedNodeId(null)}
          onConfigChange={handleConfigChange}
          onDelete={handleDeleteNode}
        />
      </div>

      <CanvasStatusBar
        nodeCount={rfNodes.length}
        edgeCount={rfEdges.length}
        validationErrors={validationErrors}
      />

      <VersionsPanel
        agentId={agentId}
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        isDirty={isDirty}
        onLoadVersion={(version) => {
          const config = version.config as { nodes?: GraphNode[]; edges?: GraphEdge[] } | undefined;
          if (config?.nodes) {
            setRfNodes(config.nodes.map(toRfNode));
            setRfEdges((config.edges ?? []).map(toRfEdge));
            setIsDirty(true);
            setSelectedNodeId(null);
            toast.success(`Loaded version ${version.version}`);
          }
          setVersionsOpen(false);
        }}
      />

      <CanvasResourcesPanel
        agentId={agentId}
        agentConfig={agentConfig}
        open={resourcesOpen}
        onOpenChange={setResourcesOpen}
      />
    </div>
  );
}

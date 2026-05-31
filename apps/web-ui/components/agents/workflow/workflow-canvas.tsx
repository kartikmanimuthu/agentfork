'use client';
import { useCallback, useRef, useState, useEffect } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, addEdge,
  useNodesState, useEdgesState, type Connection, type Node, type Edge, type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { graphToDefinition, definitionToGraph, validateGraph, type GraphNode } from '@chatbot/shared/client';
import { workflowNodeTypes } from './workflow-node-types';
import { WorkflowPalette } from './workflow-palette';
import { WorkflowInspector } from './workflow-inspector';
import { WorkflowPreviewDialog } from './workflow-preview-dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

function toGraphNode(n: Node): GraphNode {
  return { id: n.id, type: (n.type as GraphNode['type']) ?? 'text', position: n.position, data: n.data as GraphNode['data'] };
}

interface Props {
  agentId: string;
  initialActive: boolean;
  initialShowThinking: boolean;
}

export function WorkflowCanvas({ agentId, initialActive, initialShowThinking }: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActive] = useState(initialActive);
  const [showThinking, setShowThinking] = useState(initialShowThinking);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/agents/${agentId}/workflows`).then((r) => r.json()).then((wf) => {
      if (wf?.definition) {
        const g = definitionToGraph(wf.definition);
        setRfNodes(g.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })));
        setRfEdges(g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined })));
        setActive(!!wf.isActive);
      }
    }).catch(() => {});
    // Self-heal showThinking from the agent record — the parent may seed it from a
    // partial agent projection (e.g. the widget list omits showThinking).
    fetch(`/api/agents/${agentId}`).then((r) => r.json()).then((agent) => {
      if (agent && typeof agent.showThinking === 'boolean') setShowThinking(agent.showThinking);
    }).catch(() => {});
  }, [agentId, setRfNodes, setRfEdges]);

  const onConnect: OnConnect = useCallback((c: Connection) => setRfEdges((eds) => addEdge(c, eds)), [setRfEdges]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/workflow/type') as GraphNode['type'];
    if (!type) return;
    const bounds = wrapper.current!.getBoundingClientRect();
    const position = { x: event.clientX - bounds.left - 90, y: event.clientY - bounds.top - 30 };
    const id = `${type}_${Date.now()}`;
    const data = type === 'menu' ? { title: 'Menu', options: [] } : type === 'text' ? { text: '' } : { fileRef: '' };
    setRfNodes((nds) => [...nds, { id, type, position, data }]);
  }, [setRfNodes]);

  const onInspectorChange = useCallback((id: string, data: GraphNode['data']) => {
    setRfNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data } : n)));
  }, [setRfNodes]);

  const buildGraph = useCallback(() => {
    const nodes = rfNodes.map(toGraphNode);
    const edges = rfEdges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null }));
    return { nodes, edges };
  }, [rfNodes, rfEdges]);

  const handleSave = useCallback(async () => {
    const { nodes, edges } = buildGraph();
    const errors = validateGraph(nodes, edges);
    if (errors.length) { toast.error(errors[0].message); return; }
    setSaving(true);
    try {
      const def = graphToDefinition(nodes, edges);
      const res = await fetch(`/api/agents/${agentId}/workflows`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(def) });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      toast.success('Workflow saved');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }, [agentId, buildGraph]);

  const handleActivate = useCallback(async (next: boolean) => {
    setActive(next);
    const res = await fetch(`/api/agents/${agentId}/workflows/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: next }) });
    if (!res.ok) { setActive(!next); toast.error('Activation failed — save the workflow first'); }
    else toast.success(next ? 'Workflow active' : 'Workflow deactivated');
  }, [agentId]);

  const handleThinking = useCallback(async (next: boolean) => {
    setShowThinking(next);
    await fetch(`/api/agents/${agentId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ showThinking: next }) }).catch(() => {});
  }, [agentId]);

  const selectedNode = selectedId ? (rfNodes.find((n) => n.id === selectedId) as Node | undefined) : undefined;

  return (
    <div className="flex flex-col h-[70vh] border rounded-lg overflow-hidden">
      <div className="flex items-center gap-4 border-b px-4 py-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        <div className="flex items-center gap-2"><Switch checked={active} onCheckedChange={handleActivate} id="wf-active" /><Label htmlFor="wf-active">Active</Label></div>
        <div className="flex items-center gap-2"><Switch checked={showThinking} onCheckedChange={handleThinking} id="wf-think" /><Label htmlFor="wf-think">Show thinking</Label></div>
        <div className="ml-auto"><WorkflowPreviewDialog agentId={agentId} getDefinition={() => graphToDefinition(buildGraph().nodes, buildGraph().edges)} /></div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <WorkflowPalette />
        <div ref={wrapper} className="flex-1 relative" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}>
          <ReactFlow
            nodes={rfNodes} edges={rfEdges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)} onPaneClick={() => setSelectedId(null)}
            nodeTypes={workflowNodeTypes} fitView className="bg-muted/20"
          >
            <Background /><Controls /><MiniMap zoomable pannable />
          </ReactFlow>
        </div>
        <WorkflowInspector node={selectedNode ? toGraphNode(selectedNode) : null} onChange={onInspectorChange} onClose={() => setSelectedId(null)} />
      </div>
    </div>
  );
}

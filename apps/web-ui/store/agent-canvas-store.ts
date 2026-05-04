import { create } from 'zustand';
import type { GraphNode, GraphEdge } from '@chatbot/agent-studio';

export interface CanvasState {
  // Current agent being edited
  agentId: string | null;
  agentVersionId: string | null;

  // Graph state
  nodes: GraphNode[];
  edges: GraphEdge[];

  // UI state
  selectedNodeId: string | null;
  isDirty: boolean;

  // Actions
  setAgent: (agentId: string, versionId: string | null) => void;
  setGraph: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  addNode: (node: GraphNode) => void;
  updateNode: (id: string, updates: Partial<GraphNode>) => void;
  removeNode: (id: string) => void;
  addEdge: (edge: GraphEdge) => void;
  removeEdge: (id: string) => void;
  selectNode: (id: string | null) => void;
  markClean: () => void;
  reset: () => void;
}

const initialState = {
  agentId: null,
  agentVersionId: null,
  nodes: [],
  edges: [],
  selectedNodeId: null,
  isDirty: false,
};

export const useAgentCanvasStore = create<CanvasState>((set) => ({
  ...initialState,

  setAgent: (agentId, versionId) =>
    set({ agentId, agentVersionId: versionId, isDirty: false }),

  setGraph: (nodes, edges) =>
    set({ nodes, edges, isDirty: false }),

  addNode: (node) =>
    set((state) => ({
      nodes: [...state.nodes, node],
      isDirty: true,
    })),

  updateNode: (id, updates) =>
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
      isDirty: true,
    })),

  removeNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      // Also remove edges connected to this node
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      isDirty: true,
    })),

  addEdge: (edge) =>
    set((state) => ({
      edges: [...state.edges, edge],
      isDirty: true,
    })),

  removeEdge: (id) =>
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== id),
      isDirty: true,
    })),

  selectNode: (id) => set({ selectedNodeId: id }),

  markClean: () => set({ isDirty: false }),

  reset: () => set(initialState),
}));

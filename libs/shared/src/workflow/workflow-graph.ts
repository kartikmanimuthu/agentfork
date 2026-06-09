import type {
  GraphNode, GraphEdge, GraphError, WorkflowDefinition, WorkflowNode, WorkflowTransition,
} from './workflow-types';

function nodeToWorkflowNode(n: GraphNode): WorkflowNode {
  if (n.type === 'menu') return { id: n.id, type: 'menu', title: n.data.title, options: n.data.options ?? [] };
  if (n.type === 'text') return { id: n.id, type: 'text', text: n.data.text ?? '' };
  return { id: n.id, type: 'file', fileRef: n.data.fileRef ?? '' };
}

function findEntry(nodes: GraphNode[], edges: GraphEdge[]): string | undefined {
  const hasInbound = new Set(edges.map((e) => e.target));
  const entries = nodes.filter((n) => !hasInbound.has(n.id));
  return entries.length === 1 ? entries[0].id : undefined;
}

export function graphToDefinition(nodes: GraphNode[], edges: GraphEdge[]): WorkflowDefinition {
  const entryNodeId = findEntry(nodes, edges) ?? nodes[0]?.id ?? '';
  const transitions: WorkflowTransition[] = edges
    .filter((e) => e.sourceHandle)
    .map((e) => ({ fromNodeId: e.source, optionValue: e.sourceHandle as string, toNodeId: e.target }));
  return { entryNodeId, nodes: nodes.map(nodeToWorkflowNode), transitions };
}

export function definitionToGraph(def: WorkflowDefinition): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const depth = new Map<string, number>();
  depth.set(def.entryNodeId, 0);
  let changed = true;
  let guard = 0;
  while (changed && guard++ < def.nodes.length + 1) {
    changed = false;
    for (const t of def.transitions) {
      const d = depth.get(t.fromNodeId);
      if (d !== undefined && (depth.get(t.toNodeId) ?? -1) < d + 1) {
        depth.set(t.toNodeId, d + 1);
        changed = true;
      }
    }
  }
  const tierCounts = new Map<number, number>();
  const nodes: GraphNode[] = def.nodes.map((n) => {
    const d = depth.get(n.id) ?? 0;
    const row = tierCounts.get(d) ?? 0;
    tierCounts.set(d, row + 1);
    const data =
      n.type === 'menu' ? { title: n.title, options: n.options }
      : n.type === 'text' ? { text: n.text }
      : { fileRef: n.fileRef };
    return { id: n.id, type: n.type, position: { x: d * 240, y: row * 140 }, data };
  });
  const edges: GraphEdge[] = def.transitions.map((t, i) => ({
    id: `e${i}`, source: t.fromNodeId, target: t.toNodeId, sourceHandle: t.optionValue,
  }));
  return { nodes, edges };
}

export function validateGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphError[] {
  const errors: GraphError[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hasInbound = new Set(edges.map((e) => e.target));
  const entries = nodes.filter((n) => !hasInbound.has(n.id));
  if (entries.length === 0) errors.push({ code: 'no-entry', message: 'No entry node — every node has an inbound edge (cycle).' });
  if (entries.length > 1) errors.push({ code: 'multiple-entry', message: `Multiple entry nodes: ${entries.map((e) => e.id).join(', ')}.` });

  for (const n of nodes) {
    if (n.type === 'menu') {
      const values = (n.data.options ?? []).map((o) => o.value);
      const seen = new Set<string>();
      for (const v of values) {
        if (seen.has(v)) errors.push({ code: 'dup-option-value', message: `Duplicate option value "${v}" in menu ${n.id}.`, nodeId: n.id });
        seen.add(v);
      }
    }
  }

  for (const e of edges) {
    if (!byId.has(e.target)) errors.push({ code: 'missing-target', message: `Edge ${e.id} targets missing node ${e.target}.` });
    const src = byId.get(e.source);
    if (src && src.type === 'menu') {
      const ok = (src.data.options ?? []).some((o) => o.value === e.sourceHandle);
      if (!ok) errors.push({ code: 'dangling-transition', message: `Edge ${e.id} handle "${e.sourceHandle}" is not an option on menu ${e.source}.`, nodeId: e.source });
    }
  }

  const entry = entries.length === 1 ? entries[0].id : undefined;
  if (entry) {
    const reach = new Set<string>([entry]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of edges) if (reach.has(e.source) && !reach.has(e.target)) { reach.add(e.target); changed = true; }
    }
    for (const n of nodes) if (!reach.has(n.id)) errors.push({ code: 'unreachable', message: `Node ${n.id} is unreachable from entry.`, nodeId: n.id });
  }
  return errors;
}

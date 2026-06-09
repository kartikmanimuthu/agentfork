import { describe, it, expect } from 'vitest';
import { graphToDefinition, definitionToGraph, validateGraph } from './workflow-graph';
import type { GraphNode, GraphEdge } from './workflow-types';

const nodes: GraphNode[] = [
  { id: 'main', type: 'menu', position: { x: 0, y: 0 }, data: { title: 'Pick', options: [
    { label: 'Billing', value: 'billing' }, { label: 'Support', value: 'support' },
  ] } },
  { id: 'bill', type: 'menu', position: { x: 200, y: 0 }, data: { title: 'Billing', options: [{ label: 'Refund', value: 'refund' }] } },
  { id: 'supp', type: 'text', position: { x: 200, y: 120 }, data: { text: 'Describe your issue.' } },
  { id: 'done', type: 'text', position: { x: 400, y: 0 }, data: { text: 'Refund started.' } },
];
const edges: GraphEdge[] = [
  { id: 'e1', source: 'main', target: 'bill', sourceHandle: 'billing' },
  { id: 'e2', source: 'main', target: 'supp', sourceHandle: 'support' },
  { id: 'e3', source: 'bill', target: 'done', sourceHandle: 'refund' },
];

describe('graphToDefinition', () => {
  it('maps nodes + edges to a WorkflowDefinition with entry = node with no inbound edge', () => {
    const def = graphToDefinition(nodes, edges);
    expect(def.entryNodeId).toBe('main');
    expect(def.nodes).toHaveLength(4);
    expect(def.transitions).toEqual([
      { fromNodeId: 'main', optionValue: 'billing', toNodeId: 'bill' },
      { fromNodeId: 'main', optionValue: 'support', toNodeId: 'supp' },
      { fromNodeId: 'bill', optionValue: 'refund', toNodeId: 'done' },
    ]);
    const menu = def.nodes.find((n) => n.id === 'main');
    expect(menu).toEqual({ id: 'main', type: 'menu', title: 'Pick', options: [
      { label: 'Billing', value: 'billing' }, { label: 'Support', value: 'support' },
    ] });
    expect(def.nodes.find((n) => n.id === 'supp')).toEqual({ id: 'supp', type: 'text', text: 'Describe your issue.' });
  });
});

describe('definitionToGraph', () => {
  it('round-trips a definition back to nodes + edges', () => {
    const def = graphToDefinition(nodes, edges);
    const g = definitionToGraph(def);
    const def2 = graphToDefinition(g.nodes, g.edges);
    expect(def2.entryNodeId).toBe(def.entryNodeId);
    expect(def2.transitions).toEqual(def.transitions);
    expect(def2.nodes).toEqual(def.nodes);
  });
  it('assigns deterministic tiered positions when none are stored', () => {
    const def = graphToDefinition(nodes, edges);
    const g = definitionToGraph(def);
    const main = g.nodes.find((n) => n.id === 'main')!;
    const bill = g.nodes.find((n) => n.id === 'bill')!;
    expect(main.position.x).toBeLessThan(bill.position.x);
  });
});

describe('validateGraph', () => {
  it('passes a well-formed graph', () => {
    expect(validateGraph(nodes, edges)).toEqual([]);
  });
  it('flags no entry (every node has an inbound edge — a cycle)', () => {
    const cyclic: GraphEdge[] = [...edges, { id: 'e4', source: 'done', target: 'main', sourceHandle: 'x' }];
    const errs = validateGraph(nodes, cyclic);
    expect(errs.some((e) => e.code === 'no-entry')).toBe(true);
  });
  it('flags multiple entries', () => {
    const extra: GraphNode[] = [...nodes, { id: 'orphan', type: 'text', position: { x: 0, y: 300 }, data: { text: 'hi' } }];
    const errs = validateGraph(extra, edges);
    expect(errs.some((e) => e.code === 'multiple-entry')).toBe(true);
  });
  it('flags an edge whose sourceHandle is not an option on the source menu', () => {
    const bad: GraphEdge[] = [...edges, { id: 'e5', source: 'main', target: 'done', sourceHandle: 'ghost' }];
    const errs = validateGraph(nodes, bad);
    expect(errs.some((e) => e.code === 'dangling-transition')).toBe(true);
  });
  it('flags an edge to a missing target node', () => {
    const bad: GraphEdge[] = [{ id: 'e1', source: 'main', target: 'nope', sourceHandle: 'billing' }];
    const errs = validateGraph(nodes, bad);
    expect(errs.some((e) => e.code === 'missing-target')).toBe(true);
  });
  it('flags duplicate option values within one menu', () => {
    const dup: GraphNode[] = [{ ...nodes[0], data: { title: 'Pick', options: [
      { label: 'A', value: 'x' }, { label: 'B', value: 'x' },
    ] } }, ...nodes.slice(1)];
    const errs = validateGraph(dup, edges);
    expect(errs.some((e) => e.code === 'dup-option-value')).toBe(true);
  });
});

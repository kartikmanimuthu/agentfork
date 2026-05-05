import { describe, it, expect } from 'vitest';
import { GraphValidationService } from './graph-validation-service';
import type { GraphDefinition, GraphNode } from '../types/agent';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const llmNode = (id: string): GraphNode =>
  GraphValidationService._makeNode({ id, config: { type: 'llm', model: 'test-model' } });

const toolNode = (id: string): GraphNode =>
  GraphValidationService._makeNode({ id, config: { type: 'tool', toolName: 'search' } });

const routerNode = (id: string, targets: string[]): GraphNode =>
  GraphValidationService._makeNode({
    id,
    config: {
      type: 'router',
      conditions: targets.map((t) => ({ condition: 'x > 0', target: t })),
    },
  });

const stateSchemaNode = (id: string): GraphNode =>
  GraphValidationService._makeNode({
    id,
    config: { type: 'state_schema', fields: [{ name: 'query', type: 'string' }] },
  });

const edge = (source: string, target: string) => ({
  id: `${source}->${target}`,
  source,
  target,
});

const validLinear = (): GraphDefinition => ({
  nodes: [llmNode('a'), llmNode('b')],
  edges: [edge('a', 'b')],
});

// ─── validate (integration) ───────────────────────────────────────────────────

describe('GraphValidationService.validate', () => {
  it('returns valid for a minimal two-node graph', () => {
    const result = GraphValidationService.validate(validLinear());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accumulates errors from multiple rules', () => {
    // orphan node + bad edge reference
    const graph: GraphDefinition = {
      nodes: [llmNode('a'), llmNode('orphan')],
      edges: [edge('a', 'missing')],
    };
    const result = GraphValidationService.validate(graph);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});

// ─── validateEdgeReferences ───────────────────────────────────────────────────

describe('GraphValidationService.validateEdgeReferences', () => {
  it('passes when all edge endpoints exist', () => {
    expect(GraphValidationService.validateEdgeReferences(validLinear())).toHaveLength(0);
  });

  it('errors when source node is missing', () => {
    const graph: GraphDefinition = {
      nodes: [llmNode('b')],
      edges: [edge('missing', 'b')],
    };
    const errors = GraphValidationService.validateEdgeReferences(graph);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('INVALID_EDGE_SOURCE');
  });

  it('errors when target node is missing', () => {
    const graph: GraphDefinition = {
      nodes: [llmNode('a')],
      edges: [edge('a', 'missing')],
    };
    const errors = GraphValidationService.validateEdgeReferences(graph);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('INVALID_EDGE_TARGET');
  });

  it('reports both source and target errors on the same edge', () => {
    const graph: GraphDefinition = {
      nodes: [],
      edges: [edge('x', 'y')],
    };
    const errors = GraphValidationService.validateEdgeReferences(graph);
    expect(errors).toHaveLength(2);
  });
});

// ─── validateEntryNode ────────────────────────────────────────────────────────

describe('GraphValidationService.validateEntryNode', () => {
  it('passes for a graph with exactly one entry node', () => {
    expect(GraphValidationService.validateEntryNode(validLinear())).toHaveLength(0);
  });

  it('passes for an empty graph', () => {
    expect(
      GraphValidationService.validateEntryNode({ nodes: [], edges: [] })
    ).toHaveLength(0);
  });

  it('errors when all nodes have incoming edges (cycle with no entry)', () => {
    const graph: GraphDefinition = {
      nodes: [llmNode('a'), llmNode('b')],
      edges: [edge('a', 'b'), edge('b', 'a')],
    };
    const errors = GraphValidationService.validateEntryNode(graph);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('NO_ENTRY_NODE');
  });

  it('errors when multiple nodes have no incoming edges', () => {
    const graph: GraphDefinition = {
      nodes: [llmNode('a'), llmNode('b'), llmNode('c')],
      edges: [edge('a', 'c'), edge('b', 'c')],
    };
    const errors = GraphValidationService.validateEntryNode(graph);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('MULTIPLE_ENTRY_NODES');
  });
});

// ─── validateNoOrphanNodes ────────────────────────────────────────────────────

describe('GraphValidationService.validateNoOrphanNodes', () => {
  it('passes when all nodes are connected', () => {
    expect(GraphValidationService.validateNoOrphanNodes(validLinear())).toHaveLength(0);
  });

  it('passes for a single-node graph', () => {
    expect(
      GraphValidationService.validateNoOrphanNodes({ nodes: [llmNode('a')], edges: [] })
    ).toHaveLength(0);
  });

  it('errors for an orphan node', () => {
    const graph: GraphDefinition = {
      nodes: [llmNode('a'), llmNode('b'), llmNode('orphan')],
      edges: [edge('a', 'b')],
    };
    const errors = GraphValidationService.validateNoOrphanNodes(graph);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('ORPHAN_NODE');
    expect(errors[0].field).toContain('orphan');
  });

  it('reports multiple orphans', () => {
    const graph: GraphDefinition = {
      nodes: [llmNode('a'), llmNode('b'), llmNode('o1'), llmNode('o2')],
      edges: [edge('a', 'b')],
    };
    const errors = GraphValidationService.validateNoOrphanNodes(graph);
    expect(errors).toHaveLength(2);
  });
});

// ─── validateRouterEdges ──────────────────────────────────────────────────────

describe('GraphValidationService.validateRouterEdges', () => {
  it('passes when router has enough outgoing edges', () => {
    const graph: GraphDefinition = {
      nodes: [routerNode('r', ['b', 'c']), llmNode('b'), llmNode('c')],
      edges: [edge('r', 'b'), edge('r', 'c')],
    };
    expect(GraphValidationService.validateRouterEdges(graph)).toHaveLength(0);
  });

  it('errors when router has fewer outgoing edges than conditions', () => {
    const graph: GraphDefinition = {
      nodes: [routerNode('r', ['b', 'c']), llmNode('b'), llmNode('c')],
      edges: [edge('r', 'b')], // only one edge for two conditions
    };
    const errors = GraphValidationService.validateRouterEdges(graph);
    expect(errors.some((e) => e.code === 'ROUTER_MISSING_EDGES')).toBe(true);
  });

  it('errors when a condition target does not exist', () => {
    const graph: GraphDefinition = {
      nodes: [routerNode('r', ['missing']), llmNode('b')],
      edges: [edge('r', 'b')],
    };
    const errors = GraphValidationService.validateRouterEdges(graph);
    expect(errors.some((e) => e.code === 'ROUTER_INVALID_TARGET')).toBe(true);
  });

  it('errors when defaultTarget does not exist', () => {
    const rNode: GraphNode = GraphValidationService._makeNode({
      id: 'r',
      config: {
        type: 'router',
        conditions: [{ condition: 'x > 0', target: 'b' }],
        defaultTarget: 'nonexistent',
      },
    });
    const graph: GraphDefinition = {
      nodes: [rNode, llmNode('b')],
      edges: [edge('r', 'b')],
    };
    const errors = GraphValidationService.validateRouterEdges(graph);
    expect(errors.some((e) => e.code === 'ROUTER_INVALID_DEFAULT_TARGET')).toBe(true);
  });

  it('passes for non-router nodes', () => {
    const graph: GraphDefinition = {
      nodes: [llmNode('a'), toolNode('b')],
      edges: [edge('a', 'b')],
    };
    expect(GraphValidationService.validateRouterEdges(graph)).toHaveLength(0);
  });
});

// ─── validateStateSchema ──────────────────────────────────────────────────────

describe('GraphValidationService.validateStateSchema', () => {
  it('passes with zero state_schema nodes', () => {
    expect(GraphValidationService.validateStateSchema(validLinear())).toHaveLength(0);
  });

  it('passes with exactly one state_schema node', () => {
    const graph: GraphDefinition = {
      nodes: [stateSchemaNode('s'), llmNode('a')],
      edges: [edge('s', 'a')],
    };
    expect(GraphValidationService.validateStateSchema(graph)).toHaveLength(0);
  });

  it('errors with two state_schema nodes', () => {
    const graph: GraphDefinition = {
      nodes: [stateSchemaNode('s1'), stateSchemaNode('s2'), llmNode('a')],
      edges: [edge('s1', 'a'), edge('s2', 'a')],
    };
    const errors = GraphValidationService.validateStateSchema(graph);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('MULTIPLE_STATE_SCHEMA_NODES');
  });
});

// ─── validateNodeConfigs ──────────────────────────────────────────────────────

describe('GraphValidationService.validateNodeConfigs', () => {
  it('passes for valid node configs', () => {
    expect(GraphValidationService.validateNodeConfigs(validLinear())).toHaveLength(0);
  });

  it('errors for an unknown node type', () => {
    const node = GraphValidationService._makeNode({
      id: 'x',
      // @ts-expect-error intentionally invalid type for test
      config: { type: 'unknown_type' },
    });
    const graph: GraphDefinition = { nodes: [node], edges: [] };
    const errors = GraphValidationService.validateNodeConfigs(graph);
    expect(errors.some((e) => e.code === 'UNKNOWN_NODE_TYPE')).toBe(true);
  });

  it('errors for an LLM node with empty model', () => {
    const node = GraphValidationService._makeNode({
      id: 'x',
      config: { type: 'llm', model: '' },
    });
    const graph: GraphDefinition = { nodes: [node], edges: [] };
    const errors = GraphValidationService.validateNodeConfigs(graph);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].field).toContain('model');
  });
});
